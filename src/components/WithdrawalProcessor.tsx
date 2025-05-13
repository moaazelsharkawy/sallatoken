
import React, { useState } from 'react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const WithdrawalProcessor: React.FC = () => {
  const [serverStatus, setServerStatus] = useState<'running' | 'stopped'>('stopped');
  const [logs, setLogs] = useState<Array<{timestamp: string, message: string, type: 'info' | 'error' | 'success'}>>([]);

  const toggleServer = () => {
    if (serverStatus === 'stopped') {
      setServerStatus('running');
      addLog('Server started successfully', 'success');
      addLog('Listening for withdrawal requests at /api/process-solana-withdrawal', 'info');
    } else {
      setServerStatus('stopped');
      addLog('Server stopped', 'info');
    }
  };

  const addLog = (message: string, type: 'info' | 'error' | 'success') => {
    const now = new Date();
    const timestamp = now.toISOString();
    setLogs(prevLogs => [...prevLogs, { timestamp, message, type }]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="col-span-1 lg:col-span-1 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Server Control</h2>
        <div className="flex items-center space-x-3 mb-6">
          <div className="flex-1">Status: </div>
          <Badge variant={serverStatus === 'running' ? 'default' : 'secondary'}>
            {serverStatus.toUpperCase()}
          </Badge>
        </div>
        <Button 
          onClick={toggleServer} 
          variant={serverStatus === 'running' ? 'destructive' : 'default'}
          className="w-full"
        >
          {serverStatus === 'running' ? 'Stop Server' : 'Start Server'}
        </Button>
        <div className="mt-6">
          <h3 className="font-medium mb-2">Environment Configuration</h3>
          <Alert className="text-xs mb-2">
            <AlertDescription>
              ✓ API Key: Configured
            </AlertDescription>
          </Alert>
          <Alert className="text-xs mb-2">
            <AlertDescription>
              ✓ Solana RPC URL: Configured
            </AlertDescription>
          </Alert>
          <Alert className="text-xs mb-2">
            <AlertDescription className="text-yellow-600">
              ⚠ Solana Wallet: Not detected
            </AlertDescription>
          </Alert>
        </div>
      </div>

      <div className="col-span-1 lg:col-span-2 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">Server Logs</h2>
        <div className="bg-gray-900 text-green-400 p-4 rounded h-[400px] overflow-y-auto font-mono text-sm">
          {logs.length === 0 ? (
            <p className="text-gray-500">No logs yet. Start the server to see activity.</p>
          ) : (
            logs.map((log, index) => (
              <div key={index} className={`mb-1 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-blue-400'}`}>
                <span className="text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</span> - {log.message}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="col-span-1 lg:col-span-3 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">API Documentation</h2>
        <div className="mb-4">
          <h3 className="font-medium mb-2">POST /api/process-solana-withdrawal</h3>
          <div className="bg-gray-100 p-4 rounded text-sm">
            <pre className="whitespace-pre-wrap">
{`Request Body:
{
  "request_id": 123,
  "user_id": 456,
  "amount": "10.5",
  "recipient_address": "UserSolanaWalletAddress",
  "token_address": "8rbpFAM5BftdA3gouobPDih4ZxVXtTzHh7F88yARRGSZ",
  "api_key": "YOUR_API_KEY"
}`}
            </pre>
          </div>
        </div>
        <div>
          <h3 className="font-medium mb-2">GET /api/transaction-status/:request_id</h3>
          <div className="bg-gray-100 p-4 rounded text-sm">
            <pre className="whitespace-pre-wrap">
{`Response:
{
  "status": "submitted" | "confirmed" | "failed",
  "transaction_id": "SolanaTransactionID",
  "message": "Status description"
}`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WithdrawalProcessor;
