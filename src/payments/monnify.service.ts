import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { sha512 } from 'js-sha512';

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>('MONNIFY_BASE_URL'),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── AUTHENTICATION ───────────────────────────────────────────────
  // Monnify uses Basic Auth to get a bearer token
  // Token expires — we cache it and refresh when needed

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && now < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const apiKey = this.config.get<string>('MONNIFY_API_KEY');
    const secretKey = this.config.get<string>('MONNIFY_SECRET_KEY');

    // Monnify expects Base64(apiKey:secretKey)
    const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    try {
      const response = await this.http.post(
        '/api/v1/auth/login',
        {},
        {
          headers: { Authorization: `Basic ${credentials}` },
        },
      );

      const { accessToken, expiresIn } = response.data.responseBody;
      this.accessToken = accessToken;
      // expiresIn is in seconds — convert to ms timestamp
      this.tokenExpiresAt = now + expiresIn * 1000;

      this.logger.log('Monnify access token refreshed');
      return this.accessToken!;
    } catch (error) {
      this.logger.error('Failed to authenticate with Monnify', error);
      throw new InternalServerErrorException('Payment service unavailable');
    }
  }

  // ─── AUTHENTICATED REQUEST HELPER ────────────────────────────────

 private async request<T>(
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  data?: any,
): Promise<T> {
  const token = await this.getAccessToken();

  try {
    const response = await this.http.request({
      method,
      url,
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.responseBody;
  } catch (error: any) {
    // Log the FULL error response for debugging
    this.logger.error(
      `Monnify API error [${url}]: ${JSON.stringify(error.response?.data)}`,
    );
    const message =
      error.response?.data?.responseMessage || error.message;
    throw new InternalServerErrorException(`Payment error: ${message}`);
  }
}

  // ─── CREATE SUB ACCOUNT ───────────────────────────────────────────
  // Called async after driver registers bank details
  // Returns the subAccountCode to store on User record

 async createSubAccount(driver: {
  name: string;
  email: string;
  bankCode: string;
  accountNumber: string;
}): Promise<string> {

  // Request body is an ARRAY per Monnify docs
  const payload = [
    {
      currencyCode: 'NGN',
      bankCode: driver.bankCode,
      accountNumber: driver.accountNumber,
      email: driver.email,
      defaultSplitPercentage: '75',
    },
  ];

  const result = await this.request<{ subAccountCode: string }[]>(
    'post',
    '/api/v1/sub-accounts',  // ← correct endpoint
    payload,
  );

  // Response is also an array — get first item
  const subAccount = result[0];
  this.logger.log(
    `Sub account created for ${driver.name}: ${subAccount.subAccountCode}`,
  );
  return subAccount.subAccountCode;
}

  // ─── INITIALISE TRANSACTION ───────────────────────────────────────
  // Creates a payment request with split config
  // Returns checkout URL for the owner to pay

  async initiateTransaction(params: {
    amount: number;
    tripId: string;
    ownerEmail: string;
    ownerName: string;
    driverSubAccountCode: string;
    driverSplitPercent: number;
  }): Promise<{ checkoutUrl: string; transactionReference: string }> {
    const contractCode = this.config.get<string>('MONNIFY_CONTRACT_CODE');

    const payload = {
      amount: params.amount,
      customerName: params.ownerName,
      customerEmail: params.ownerEmail,
      paymentReference: `BICA-${params.tripId}-${Date.now()}`,
      paymentDescription: `BICA ride payment - Trip ${params.tripId}`,
      currencyCode: 'NGN',
      contractCode,
      redirectUrl: 'https://bicadrive.app/payment/complete',
      paymentMethods: ['ACCOUNT_TRANSFER', 'CARD'],
      // Split config — driver gets their percentage, rest goes to BICA main account
      incomeSplitConfig: [
        {
          subAccountCode: params.driverSubAccountCode,
          feePercentage: 0,
          splitPercentage: params.driverSplitPercent,
          feeBearer: false,
        },
      ],
    };

    const result = await this.request<{
      checkoutUrl: string;
      transactionReference: string;
    }>('post', '/api/v1/merchant/transactions/init-transaction', payload);

    return {
      checkoutUrl: result.checkoutUrl,
      transactionReference: result.transactionReference,
    };
  }

  // ─── VERIFY TRANSACTION ───────────────────────────────────────────
  // Called after webhook to double-check payment status with Monnify
  // Never trust webhook alone — always verify with API

  async verifyTransaction(transactionReference: string): Promise<{
    paid: boolean;
    amount: number;
    paymentMethod: string;
  }> {
    const result = await this.request<{
      paymentStatus: string;
      amountPaid: number;
      paymentMethod: string;
    }>(
      'get',
      `/api/v2/transactions/${encodeURIComponent(transactionReference)}`,
    );

    return {
      paid: result.paymentStatus === 'PAID',
      amount: result.amountPaid,
      paymentMethod: result.paymentMethod,
    };
  }

  // ─── VERIFY WEBHOOK SIGNATURE ─────────────────────────────────────
  // Computes HMAC-SHA512 of secretKey + rawBody
  // Compares with monnify-signature header
  // Returns false if signature doesn't match — reject the request

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secretKey = this.config.get<string>('MONNIFY_SECRET_KEY');
    const computed = sha512.hmac(secretKey!, rawBody);
    const isValid = computed === signature;

    if (!isValid) {
      this.logger.warn('Invalid Monnify webhook signature detected');
    }

    return isValid;
  }
}