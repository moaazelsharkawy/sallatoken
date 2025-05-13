import { Request, Response } from 'express';
import { SolanaService } from '../services/solana';
import { Logger } from '../utils/logger';
import axios from 'axios';
import { config } from '../config';
import { getDatabase } from '../db';

const logger = new Logger('WithdrawalController');
let solanaService: SolanaService;

interface TransactionStatus {
  requestId: number;
  transactionId: string;
  status: 'submitted' | 'confirmed' | 'failed';
  timestamp: Date;
  userId: number;
  message?: string;
}

/**
 * معالجة طلب السحب
 * تم تحسين الدالة للتعامل مع الطلبات المكررة وفحص الرصيد قبل إجراء المعاملة
 */
export const processWithdrawal = async (req: Request, res: Response) => {
  const { request_id, user_id, amount, recipient_address, token_address } = req.body;
  const db = getDatabase();

  try {
    // تحسين التحقق من الطلبات المكررة
    const existing = db.prepare(`
      SELECT status, transaction_id, error_message FROM withdrawals
      WHERE request_id = ?
    `).get(request_id);

    if (existing) {
      // إذا كان الطلب موجودًا بالفعل، تحقق من حالته
      if (existing.status === 'completed') {
        return res.status(200).json({
          status: 'success',
          message: 'طلب السحب تم تنفيذه بالفعل',
          transaction_id: existing.transaction_id
        });
      } else if (existing.status === 'processing' && existing.transaction_id) {
        // إذا كانت المعاملة قيد المعالجة، تحقق من حالتها الحالية
        if (!solanaService) solanaService = new SolanaService();
        const currentStatus = await solanaService.checkTransactionStatus(existing.transaction_id);

        return res.status(200).json({
          status: 'processing',
          message: 'المعاملة قيد المعالجة',
          transaction_id: existing.transaction_id,
          current_status: currentStatus
        });
      } else if (existing.status === 'failed') {
        // إذا فشلت المعاملة السابقة، يمكن إعادة المحاولة
        logger.info(`إعادة محاولة طلب سحب فاشل سابقًا: ${request_id}`);
      } else {
        return res.status(400).json({
          status: 'failed',
          message: 'تمت معالجة الطلب بالفعل',
          error_code: 'duplicate_request',
          current_status: existing.status
        });
      }
    }

    // إدخال سجل جديد أو تحديث السجل الموجود
    if (!existing) {
      db.prepare(`
        INSERT INTO withdrawals
        (request_id, user_id, amount, recipient_address, token_address, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(request_id, user_id, amount, recipient_address, token_address);
    } else {
      db.prepare(`
        UPDATE withdrawals SET
        status = 'pending',
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
      `).run(request_id);
    }

    if (!solanaService) solanaService = new SolanaService();

    // --- بداية التعديل المقترح لفحص ازدحام الشبكة (معلّق حاليًا) ---
    // (ملاحظة: هذا يتطلب إضافة دالة isNetworkTooCongested إلى SolanaService
    //  ويمكن التحكم في تفعيل هذا الفحص عبر متغير في ملف الإعدادات config)
  if (config.enableNetworkCongestionCheck) {
     const isCongested = await solanaService.isNetworkTooCongested(); // يجب إنشاء هذه الدالة في SolanaService
      if (isCongested) {
      logger.warn(`رفض طلب السحب ${request_id} بسبب ازدحام الشبكة.`);
 
 
      // تحديث قاعدة البيانات بحالة فشل بسبب ازدحام الشبكة
     db.prepare(
        `UPDATE withdrawals SET status = 'failed_network_congestion', error_message = 'الشبكة مزدحمة حالياً. حاول بعد قليل.', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?`
      ).run(request_id);

       return res.status(503).json({ // 503 Service Unavailable
       status: 'failed',
       message: 'الشبكة مزدحمة حالياً. حاول بعد قليل.',
       error_code: 'network_congested',
    });
     }
 }
    // --- نهاية التعديل المقترح ---


    // التحقق من رصيد SOL قبل إجراء المعاملة
    const hasSufficientSol = await solanaService.checkSenderSolBalance();
    if (!hasSufficientSol) {
      db.prepare(`
        UPDATE withdrawals SET
        status = 'failed',
        error_message = 'رصيد SOL غير كافٍ لرسوم المعاملة',
        updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
      `).run(request_id);

      return res.status(400).json({
        status: 'failed',
        message: 'رصيد SOL غير كافٍ لرسوم المعاملة',
        error_code: 'insufficient_sol',
      });
    }

    // التحقق من رصيد الرمز المميز قبل إجراء المعاملة
    const hasSufficientTokens = await solanaService.checkSenderTokenBalance(amount);
    if (!hasSufficientTokens) {
      db.prepare(`
        UPDATE withdrawals SET
        status = 'failed',
        error_message = 'رصيد الرمز المميز غير كافٍ',
        updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
      `).run(request_id);

      return res.status(400).json({
        status: 'failed',
        message: 'رصيد الرمز المميز غير كافٍ',
        error_code: 'insufficient_token_balance',
      });
    }

    // إجراء المعاملة
    const transactionId = await solanaService.transferTokens(
      recipient_address,
      amount,
      request_id
    );

    // تحديث حالة الطلب
    db.prepare(`
      UPDATE withdrawals SET
      status = 'processing',
      transaction_id = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE request_id = ?
    `).run(transactionId, request_id);

    // بدء مراقبة المعاملة
    monitorTransaction(transactionId, request_id, user_id);

    return res.status(200).json({
      status: 'success',
      message: 'تم تقديم طلب السحب بنجاح',
      transaction_id: transactionId,
    });

  } catch (error: any) {
    logger.error(`فشل في معالجة الطلب ${request_id}`, error);

    // التحقق من حالة المعاملة عند مواجهة خطأ انتهاء صلاحية المعاملة
    if (error.message.includes('block height exceeded') && error.stack && error.stack.includes('transferTokens')) {
      logger.warn(`المعاملة للطلب ${request_id} انتهت صلاحيتها (block height exceeded). التحقق من حالتها الفعلية على الشبكة...`);
      
      // استخراج معرف المعاملة من رسالة الخطأ
      const transactionIdMatch = error.message.match(/Signature ([a-zA-Z0-9]+) has expired/);
      const transactionId = transactionIdMatch ? transactionIdMatch[1] : null;
      
      if (transactionId) {
        try {
          // انتظر لحظة قبل التحقق من حالة المعاملة
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          if (!solanaService) solanaService = new SolanaService();
          // التحقق من حالة المعاملة على الشبكة
          const actualStatus = await solanaService.checkTransactionStatus(transactionId);
          
          if (actualStatus === 'confirmed') {
            // المعاملة نجحت بالفعل رغم الخطأ
            logger.info(`المعاملة ${transactionId} للطلب ${request_id} نجحت بالفعل على الشبكة رغم خطأ انتهاء الصلاحية`);
            
            // تحديث حالة الطلب
            db.prepare(`
              UPDATE withdrawals SET
              status = 'processing',
              transaction_id = ?,
              updated_at = CURRENT_TIMESTAMP
              WHERE request_id = ?
            `).run(transactionId, request_id);
            
            // بدء مراقبة المعاملة
            monitorTransaction(transactionId, request_id, user_id);
            
            return res.status(200).json({
              status: 'success',
              message: 'تم تقديم طلب السحب بنجاح',
              transaction_id: transactionId,
            });
          }
        } catch (verificationError) {
          logger.error(`فشل في التحقق من حالة المعاملة ${transactionId} بعد خطأ انتهاء الصلاحية`, verificationError);
          // استمر في معالجة الخطأ الأصلي إذا فشل التحقق
        }
      }
    }

    db.prepare(`
      UPDATE withdrawals SET
      status = 'failed',
      error_message = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE request_id = ?
    `).run(error.message, request_id);

    let errorCode = 'transaction_error';
    if (error.message.includes('block height exceeded')) {
      errorCode = 'transaction_expired';
      logger.warn(`المعاملة للطلب ${request_id} انتهت صلاحيتها (block height exceeded). يرجى التحقق من ظروف الشبكة أو إعدادات lastValidBlockHeight.`);
    } else if (error.message.includes('Insufficient')) {
      errorCode = error.message.includes('SOL') ? 'insufficient_sol' : 'insufficient_token_balance';
    } else if (error.message.includes('timeout')) {
      errorCode = 'timeout_error';
    } else if (error.message.includes('invalid address')) {
      errorCode = 'invalid_address';
    }

    return res.status(500).json({
      status: 'failed',
      message: error.message,
      error_code: errorCode,
    });
  }
};

/**
 * الحصول على حالة المعاملة
 */
export const getTransactionStatus = (req: Request, res: Response) => {
  const requestId = parseInt(req.params.requestId, 10);
  const db = getDatabase();

  const record = db.prepare(`
    SELECT status, transaction_id, created_at, error_message, updated_at
    FROM withdrawals
    WHERE request_id = ?
  `).get(requestId);

  if (!record) {
    return res.status(404).json({
      status: 'failed',
      message: 'المعاملة غير موجودة',
      error_code: 'transaction_not_found',
    });
  }

  // إذا كانت المعاملة قيد المعالجة وتم تحديثها منذ أكثر من ساعة، تحقق من حالتها
  if (record.status === 'processing' && record.transaction_id) {
    const updatedAt = new Date(record.updated_at).getTime();
    const oneHourAgo = Date.now() - 3600000;

    if (updatedAt < oneHourAgo) {
      // تحديث حالة المعاملة في الخلفية
      if (!solanaService) solanaService = new SolanaService();
      solanaService.checkTransactionStatus(record.transaction_id)
        .then(status => {
          if (status === 'confirmed' || status === 'failed') {
            const mappedStatus = status === 'confirmed' ? 'completed' : 'failed';
            db.prepare(`
              UPDATE withdrawals SET
              status = ?,
              updated_at = CURRENT_TIMESTAMP
              WHERE request_id = ?
            `).run(mappedStatus, requestId);
          }
        })
        .catch(err => logger.error(`خطأ في تحديث حالة المعاملة ${record.transaction_id}`, err));
    }
  }

  return res.status(200).json({
    status: record.status,
    transaction_id: record.transaction_id,
    message: record.error_message || '',
    timestamp: record.created_at,
    updated_at: record.updated_at,
  });
};

/**
 * مراقبة حالة المعاملة
 * تم تحسين الدالة لمعالجة حالات الفشل والمحاولات المتكررة
 */
async function monitorTransaction(transactionId: string, requestId: number, userId: number) {
  const db = getDatabase();
  const maxRetries = 5; // عدد محاولات التحقق القصوى
  let retryCount = 0;
  const retryInterval = 15000; // 15 ثوانٍ بين المحاولات

  const monitor = async () => {
    try {
      // انتظر قبل التحقق من حالة المعاملة
      await new Promise(resolve => setTimeout(resolve, retryInterval));

      // تحقق من حالة المعاملة
      const status = await solanaService.checkTransactionStatus(transactionId);
      logger.info(`حالة المعاملة ${transactionId} للطلب ${requestId}: ${status} (محاولة ${retryCount + 1}/${maxRetries})`);

      if (status === 'confirmed') {
        // تحديث حالة المعاملة في قاعدة البيانات
        db.prepare(`
          UPDATE withdrawals SET
          status = 'completed',
          updated_at = CURRENT_TIMESTAMP
          WHERE request_id = ?
        `).run(requestId);

        // إخطار WordPress بالمعاملة المكتملة
        notifyWordPress(requestId, userId, transactionId, 'confirmed');
        return;
      } else if (status === 'failed') {
        // تحديث حالة المعاملة في قاعدة البيانات
        db.prepare(`
          UPDATE withdrawals SET
          status = 'failed',
          error_message = 'فشلت المعاملة على البلوكتشين',
          updated_at = CURRENT_TIMESTAMP
          WHERE request_id = ?
        `).run(requestId);

        // إخطار WordPress بفشل المعاملة
        notifyWordPress(requestId, userId, transactionId, 'failed', 'فشلت المعاملة على البلوكتشين');
        return;
      }

      // إذا كانت المعاملة لا تزال معلقة وعدد المحاولات أقل من الحد الأقصى
      retryCount++;
      if (retryCount < maxRetries) {
        return monitor();
      } else {
        // إذا تجاوزنا الحد الأقصى للمحاولات، اعتبر المعاملة معلقة
        logger.warn(`تجاوز الحد الأقصى لمحاولات التحقق للمعاملة ${transactionId} للطلب ${requestId}`);

        db.prepare(`
          UPDATE withdrawals SET
          status = 'pending_confirmation',
          error_message = 'انتهت مهلة مراقبة المعاملة، ستتم متابعتها لاحقًا',
          updated_at = CURRENT_TIMESTAMP
          WHERE request_id = ?
        `).run(requestId);

        // لا نرسل إشعارًا إلى WordPress في هذه الحالة لأن المعاملة قد تكتمل لاحقًا
      }
    } catch (error: any) {
      logger.error(`خطأ في مراقبة المعاملة ${transactionId} للطلب ${requestId}`, error);

      db.prepare(`
        UPDATE withdrawals SET
        status = 'failed',
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
      `).run(error.message, requestId);

      notifyWordPress(requestId, userId, transactionId, 'failed', error.message);
    }
  };

  // بدء عملية المراقبة
  monitor();
}

/**
 * إخطار WordPress بحالة المعاملة
 */
async function notifyWordPress(
  requestId: number,
  userId: number,
  transactionId: string,
  status: 'confirmed' | 'failed',
  errorMessage?: string
) {
  if (!config.wordpressCallbackUrl) {
    logger.warn(`لم يتم تكوين عنوان URL لإعادة الاتصال بـ WordPress. لا يمكن إخطار WordPress للطلب ${requestId}`);
    return;
  }

  const maxRetries = 5; // الحد الأقصى لعدد المحاولات
  let attempt = 0;
  let delay = 1000; // التأخير الأولي بالميللي ثانية (1 ثانية)

  while (attempt < maxRetries) {
    try {
      logger.info(`محاولة إرسال إشعار إلى WordPress للطلب ${requestId} (محاولة ${attempt + 1}/${maxRetries}) بالحالة: ${status}`);

      await axios.post(
        config.wordpressCallbackUrl,
        {
          request_id: requestId,
          user_id: userId,
          transaction_id: transactionId,
          status,
          message: errorMessage || (status === 'confirmed' ? 'تم تأكيد المعاملة' : 'فشلت المعاملة'),
          timestamp: new Date().toISOString(),
          callback_secret: config.callbackSecret || config.apiKey,
        },
        {
          headers: {
            'X-Callback-Secret': config.callbackSecret || config.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // مهلة 10 ثوانٍ للطلب
        }
      );

      logger.info(`تم إخطار WordPress بنجاح للطلب ${requestId} بعد ${attempt + 1} محاولة.`);
      return; // الخروج من الدالة عند النجاح
    } catch (error: any) {
      attempt++;
      logger.error(`فشل في إخطار WordPress للطلب ${requestId} (محاولة ${attempt}/${maxRetries})`, error);
      logger.error(`تفاصيل الخطأ: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);

      if (attempt < maxRetries) {
        logger.info(`إعادة المحاولة لإخطار WordPress للطلب ${requestId} بعد ${delay / 1000} ثانية...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // مضاعفة التأخير للمحاولة التالية (exponential backoff)
      } else {
        logger.error(`فشلت جميع محاولات (${maxRetries}) إخطار WordPress للطلب ${requestId}.`);
      }
    }
  }
}

/**
 * إعادة فحص المعاملات المعلقة
 * دالة جديدة لفحص المعاملات التي لم تكتمل بعد
 */
export const recheckPendingTransactions = async (req: Request, res: Response) => {
  const db = getDatabase();

  try {
    // جلب المعاملات المعلقة
    const pendingTransactions = db.prepare(`
      SELECT request_id, user_id, transaction_id
      FROM withdrawals
      WHERE status IN ('processing', 'pending_confirmation')
      AND transaction_id IS NOT NULL
      AND updated_at < datetime('now', '-30 minutes')
    `).all();

    if (pendingTransactions.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'لا توجد معاملات معلقة للتحقق',
        count: 0
      });
    }

    if (!solanaService) solanaService = new SolanaService();

    // إنشاء مصفوفة من الوعود للتحقق من كل معاملة
    const checkPromises = pendingTransactions.map(async (tx: any) => {
      try {
        const status = await solanaService.checkTransactionStatus(tx.transaction_id);

        if (status === 'confirmed' || status === 'failed') {
          const mappedStatus = status === 'confirmed' ? 'completed' : 'failed';
          const errorMessage = status === 'failed' ? 'فشلت المعاملة على البلوكتشين' : null;

          db.prepare(`
            UPDATE withdrawals SET
            status = ?,
            error_message = ?,
            updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
          `).run(mappedStatus, errorMessage, tx.request_id);

          // إخطار WordPress
          notifyWordPress(
            tx.request_id,
            tx.user_id,
            tx.transaction_id,
            status as 'confirmed' | 'failed',
            errorMessage || undefined
          );

          return {
            request_id: tx.request_id,
            status: mappedStatus,
            updated: true
          };
        }

        return {
          request_id: tx.request_id,
          status: 'still_pending',
          updated: false
        };
      } catch (error: any) {
        logger.error(`خطأ في إعادة فحص المعاملة ${tx.transaction_id} للطلب ${tx.request_id}`, error);
        return {
          request_id: tx.request_id,
          status: 'error',
          error: error.message,
          updated: false
        };
      }
    });

    const results = await Promise.all(checkPromises);

    return res.status(200).json({
      status: 'success',
      message: 'تم إعادة فحص المعاملات المعلقة',
      count: pendingTransactions.length,
      results
    });
  } catch (error: any) {
    logger.error('فشل في إعادة فحص المعاملات المعلقة', error);
    return res.status(500).json({
      status: 'failed',
      message: error.message,
      error_code: 'recheck_error'
    });
  }
};
