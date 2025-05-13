import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  ConnectionConfig,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint
} from '@solana/spl-token';
import bs58 from 'bs58';
import { config, buildSolanaRpcUrl } from '../config';
import { Logger } from '../utils/logger';
import { getDatabase } from '../db';

const logger = new Logger('SolanaService');

export class SolanaService {
  private connection: Connection;
  private senderKeypair: Keypair;
  private tokenAddress: PublicKey;
  private tokenDecimals: number | null = null;

  constructor() {
    const rpcUrl = buildSolanaRpcUrl();
    const connectionConfig: ConnectionConfig = { commitment: 'confirmed' };

    this.connection = new Connection(rpcUrl, connectionConfig);
    this.senderKeypair = Keypair.fromSecretKey(bs58.decode(config.senderPrivateKey));
    this.tokenAddress = new PublicKey(config.tokenAddress);

    this.fetchTokenDecimals().catch(error => {
      logger.error('Initial decimals fetch failed', error);
    });
  }

  public async fetchTokenDecimals(): Promise<void> {
    if (this.tokenDecimals !== null) return;
    try {
      const mint = await getMint(this.connection, this.tokenAddress);
      this.tokenDecimals = mint.decimals;
    } catch (error: any) {
      throw new Error(`Failed to fetch decimals: ${error.message}`);
    }
  }

  async checkSenderSolBalance(): Promise<boolean> {
    try {
      const balance = await this.connection.getBalance(this.senderKeypair.publicKey);
      return balance >= 0.005 * LAMPORTS_PER_SOL;
    } catch (error: any) {
      throw new Error(`SOL balance check failed: ${error.message}`);
    }
  }

  async checkSenderTokenBalance(amount: string | number): Promise<boolean> {
    if (this.tokenDecimals === null) await this.fetchTokenDecimals();
    try {
      const senderTokenAccount = await getAssociatedTokenAddress(
        this.tokenAddress,
        this.senderKeypair.publicKey
      );
      const tokenAccountInfo = await getAccount(this.connection, senderTokenAccount);
      const transferAmount = Number(amount) * (10 ** this.tokenDecimals!);
      return Number(tokenAccountInfo.amount) >= transferAmount;
    } catch (error: any) {
      if (error.message.includes('Account not found')) return false;
      throw new Error(`Token balance check failed: ${error.message}`);
    }
  }

  async transferTokens(
    recipientAddress: string,
    amount: string | number,
    requestId: number
  ): Promise<string> {
    if (this.tokenDecimals === null) await this.fetchTokenDecimals();

    const db = getDatabase();
    const transferAmountRaw = Number(amount) * (10 ** this.tokenDecimals!);

    // تحديث حالة السحب إلى "قيد المعالجة"
    db.prepare(
      `UPDATE withdrawals SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?`
    ).run(requestId);

    try {
      // بناء المعاملة
      const recipientPubKey = new PublicKey(recipientAddress);
      const recipientTokenAccount = await getAssociatedTokenAddress(
        this.tokenAddress,
        recipientPubKey
      );
      const senderTokenAccount = await getAssociatedTokenAddress(
        this.tokenAddress,
        this.senderKeypair.publicKey
      );

      // إنشاء المعاملة
      const transaction = new Transaction();
      
      // التحقق مما إذا كان حساب الرمز المميز للمستلم موجودًا
      let recipientAccountExists = false;
      try {
        await getAccount(this.connection, recipientTokenAccount);
        recipientAccountExists = true;
        logger.info(`Recipient token account exists for ${recipientAddress}`);
      } catch (error: any) {
        // حساب الرمز المميز للمستلم غير موجود، سنقوم بإنشائه
        logger.info(`Recipient token account does not exist, creating it for ${recipientAddress}`);
      }

      // إضافة تعليمات إنشاء حساب الرمز المميز للمستلم إذا لم يكن موجودًا
      if (!recipientAccountExists) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.senderKeypair.publicKey,  // الدافع
            recipientTokenAccount,         // حساب الرمز المميز الجديد
            recipientPubKey,               // المالك
            this.tokenAddress              // عنوان الرمز المميز
          )
        );
        logger.info(`Added instruction to create token account for recipient ${recipientAddress}`);
      }

      // إضافة تعليمات التحويل
      transaction.add(
        createTransferInstruction(
          senderTokenAccount,
          recipientTokenAccount,
          this.senderKeypair.publicKey,
          BigInt(Math.floor(transferAmountRaw))
        )
      );

      // إرسال المعاملة وانتظار التأكيد
      const txid = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.senderKeypair],
        { 
          commitment: 'confirmed',
          maxRetries: 5
        }
      );

      // نجاح المعاملة
      db.prepare(
        `UPDATE withdrawals SET transaction_id = ?, status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?`
      ).run(txid, requestId);
      
      logger.info(`Transaction ${txid} for request ${requestId} confirmed successfully`);
      return txid;
    } catch (error: any) {
      // فشل المعاملة
      logger.error(`Transaction for request ${requestId} failed: ${error.message}`);
      
      // تسجيل المزيد من التفاصيل إذا كان الخطأ من نوع SendTransactionError
      if (error.logs) {
        logger.error(`Transaction logs: ${JSON.stringify(error.logs)}`);
      }
      
      db.prepare(
        `UPDATE withdrawals SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE request_id = ?`
      ).run(`Transaction failed: ${error.message}`, requestId);
      throw new Error(`Transaction failed: ${error.message}`);
    }
  }

  async checkTransactionStatus(
    transactionId: string
  ): Promise<'confirmed' | 'failed' | 'pending'> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 ثانية
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const transaction = await this.connection.getTransaction(transactionId, { commitment: 'confirmed' });
        
        if (!transaction) {
          // المعاملة غير موجودة في السلسلة، قد تكون معلقة أو لم يتم تضمينها بعد
          logger.debug(`Transaction ${transactionId} not found on chain yet, considering pending`);
          return 'pending';
        }
        
        // التحقق من وجود أخطاء في المعاملة
        if (transaction.meta?.err) {
          logger.error(`Transaction ${transactionId} failed with error: ${JSON.stringify(transaction.meta.err)}`);
          return 'failed';
        }
        
        // المعاملة تمت بنجاح
        logger.debug(`Transaction ${transactionId} confirmed on chain`);
        return 'confirmed';
      } catch (error: any) {
        logger.warn(`Error checking transaction ${transactionId} status (attempt ${attempt+1}/${maxRetries}): ${error.message}`);
        
        if (attempt < maxRetries - 1) {
          // انتظر قبل المحاولة التالية
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          // بعد استنفاد جميع المحاولات، نفترض أن المعاملة لا تزال معلقة
          return 'pending';
        }
      }
    }
    
    return 'pending'; // في حالة استنفاد جميع المحاولات
  }

  /**
   * فحص ما إذا كانت شبكة سولانا مزدحمة بشكل مفرط
   * يستخدم هذا لتأجيل المعاملات عندما تكون الشبكة مزدحمة لتجنب الرسوم العالية أو فشل المعاملات
   */
  async isNetworkTooCongested(): Promise<boolean> {
    try {
      // الحصول على معلومات الازدحام الحالية من الشبكة
      const recentPerformanceSamples = await this.connection.getRecentPerformanceSamples(10);
      
      if (recentPerformanceSamples.length === 0) {
        logger.warn('لم يتم الحصول على عينات أداء من الشبكة، افتراض أن الشبكة غير مزدحمة');
        return false;
      }
      
      // حساب متوسط المعاملات في الثانية (TPS)
      const avgTps = recentPerformanceSamples.reduce((sum, sample) => 
        sum + sample.numTransactions / sample.samplePeriodSecs, 0) / recentPerformanceSamples.length;
      
      // حساب متوسط نسبة الفشل
      const avgFailureRate = recentPerformanceSamples.reduce((sum, sample) => {
        const failureRate = sample.numTransactions > 0 
          ? (sample.numTransactions - sample.numSuccessfulTransactions) / sample.numTransactions 
          : 0;
        return sum + failureRate;
      }, 0) / recentPerformanceSamples.length;
      
      logger.info(`متوسط TPS: ${avgTps.toFixed(2)}, متوسط نسبة الفشل: ${(avgFailureRate * 100).toFixed(2)}%`);
      
      // تحديد ما إذا كانت الشبكة مزدحمة بناءً على العتبات المحددة في الإعدادات
      // يمكن تخصيص هذه القيم في ملف الإعدادات
      const tpsThreshold = config.networkCongestion?.tpsThreshold || 1500;
      const failureRateThreshold = config.networkCongestion?.failureRateThreshold || 0.15; // 15%
      
      const isCongested = avgTps > tpsThreshold || avgFailureRate > failureRateThreshold;
      
      if (isCongested) {
        logger.warn(`الشبكة مزدحمة: TPS=${avgTps.toFixed(2)}, نسبة الفشل=${(avgFailureRate * 100).toFixed(2)}%`);
      }
      
      return isCongested;
    } catch (error: any) {
      logger.error(`خطأ في فحص ازدحام الشبكة: ${error.message}`);
      // في حالة الخطأ، نفترض أن الشبكة غير مزدحمة لتجنب تعطيل المعاملات
      return false;
    }
  }
}
