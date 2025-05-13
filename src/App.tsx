
import React from 'react';
import WithdrawalProcessor from './components/WithdrawalProcessor';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-center text-gray-800">Solana Withdrawal Processor</h1>
      </header>
      <main className="flex-1 container mx-auto">
        <WithdrawalProcessor />
      </main>
      <footer className="mt-8 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Solana Withdrawal Processor
      </footer>
    </div>
  );
}

export default App;
