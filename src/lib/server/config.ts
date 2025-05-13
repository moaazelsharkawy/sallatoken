// Configuration for the Solana Withdrawal Processor
// باستخدام Bun.env (عند تشغيل التطبيق عبر `bun run`)

// لا حاجة لاستيراد dotenv مع Bun

export const config = {
  // API key that must be included in requests from WordPress
  apiKey: Bun.env.API_KEY || "your_api_key_here",
  
  // Solana RPC URL (e.g., Mainnet, Testnet, Devnet)
  solanaRpcUrl: Bun.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  
  // SolanaView API Key for authenticated RPC access
  solanaViewApiKey: Bun.env.SOLANAVIEW_API_KEY || "",
  
  // The private key for the sender wallet (in base58 format)
  senderPrivateKey: Bun.env.SOLANA_PRIVATE_KEY || "",
  
  // The ST token address
  tokenAddress: Bun.env.TOKEN_ADDRESS || "8rbpFAM5BftdA3gouobPDih4ZxVXtTzHh7F88yARRGSZ",
  
  // WordPress callback URL for notifying transaction status
  wordpressCallbackUrl:
    Bun.env.WORDPRESS_CALLBACK_URL ||
    "https://your-wordpress-site.com/api/solana-callback",
  
  // Secret key for WordPress callback authentication
  callbackSecret: Bun.env.CALLBACK_SECRET || "",
  
  // Server port
  port: Number(Bun.env.PORT) || 3000,
  
  // Rate limiting configuration
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  },
  
  // Request timeout in milliseconds (30 seconds)
  requestTimeout: 30000,
  
  // إعدادات فحص ازدحام الشبكة
  enableNetworkCongestionCheck: Bun.env.ENABLE_NETWORK_CONGESTION_CHECK === "true" || false,
  
  // إعدادات عتبات ازدحام الشبكة
  networkCongestion: {
    tpsThreshold: Number(Bun.env.NETWORK_CONGESTION_TPS_THRESHOLD) || 1500,
    failureRateThreshold: Number(Bun.env.NETWORK_CONGESTION_FAILURE_RATE_THRESHOLD) || 0.15, // 15%
  },
};

/**
 * Builds the final Solana RPC URL with API key if available
 */
export const buildSolanaRpcUrl = (): string => {
  const baseUrl = config.solanaRpcUrl;
  const apiKey = config.solanaViewApiKey;

  if (!apiKey) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    url.searchParams.append("apiKey", apiKey);
    return url.toString();
  } catch {
    return `${baseUrl}?apiKey=${apiKey}`;
  }
};

// Validate required configuration at startup
export const validateConfig = () => {
  const errors: string[] = [];

  if (!config.apiKey || config.apiKey === "your_api_key_here") {
    errors.push("API_KEY is not configured");
  }
  if (!config.senderPrivateKey) {
    errors.push("SOLANA_PRIVATE_KEY is not configured");
  }
  if (
    config.solanaRpcUrl.includes("solanaview.com") &&
    !config.solanaViewApiKey
  ) {
    errors.push("SOLANAVIEW_API_KEY is required when using solanaview.com");
  }

  return { isValid: errors.length === 0, errors };
};
