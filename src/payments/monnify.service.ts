import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { sha512 } from 'js-sha512';

export class MonnifyApiException extends HttpException {
  constructor(
    message: string,
    public readonly monnifyStatus?: number,
    public readonly monnifyCode?: string,
    public readonly monnifyMessage?: string,
  ) {
    const statusCode =
      (monnifyStatus ?? 500) >= 500
        ? HttpStatus.BAD_GATEWAY
        : HttpStatus.BAD_REQUEST;

    super(
      {
        message,
        error: statusCode === HttpStatus.BAD_GATEWAY ? 'Bad Gateway' : 'Bad Request',
        statusCode,
      },
      statusCode,
    );
  }
}

export type MonnifySubAccount = {
  subAccountCode: string;
  accountNumber: string;
  accountName: string;
  currencyCode: string;
  email: string;
  bankCode: string;
  bankName: string;
  defaultSplitPercentage: number;
  settlementProfileCode: string;
  settlementReportEmails: string[];
};

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private readonly http: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: ConfigService) {
    this.http = axios.create({
      baseURL: this.config.get<string>('MONNIFY_BASE_URL'),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiresAt - 60000) {
      return this.accessToken!;
    }

    const apiKey = this.config.get<string>('MONNIFY_API_KEY');
    const secretKey = this.config.get<string>('MONNIFY_SECRET_KEY');
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
      this.tokenExpiresAt = now + expiresIn * 1000;

      this.logger.log('Monnify access token refreshed');
      return this.accessToken!;
    } catch (error) {
      this.logger.error('Failed to authenticate with Monnify', error);
      throw new MonnifyApiException(
        'Payment service unavailable',
        503,
        undefined,
        'Could not authenticate with Monnify',
      );
    }
  }

  private async request<T>(
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const token = await this.getAccessToken();

    try {
      const response = await this.http.request({
        method,
        url,
        data,
        ...config,
        headers: {
          ...(config?.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data.responseBody;
    } catch (error: any) {
      const status = error.response?.status;
      const responseCode = error.response?.data?.responseCode;
      const responseMessage =
        error.response?.data?.responseMessage || error.message;

      this.logger.error(
        `Monnify API error [${method.toUpperCase()} ${url}]: ${JSON.stringify({
          status,
          responseCode,
          responseMessage,
          data: error.response?.data,
        })}`,
      );

      throw new MonnifyApiException(
        `Payment error: ${responseMessage}`,
        status,
        responseCode,
        responseMessage,
      );
    }
  }

  async createSubAccount(driver: {
    name: string;
    email: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<string> {
    const payload = [
      {
        currencyCode: 'NGN',
        bankCode: driver.bankCode,
        accountNumber: driver.accountNumber,
        email: driver.email,
        defaultSplitPercentage: 75,
      },
    ];

    const result = await this.request<MonnifySubAccount[]>(
      'post',
      '/api/v1/sub-accounts',
      payload,
    );

    const subAccount = result[0];
    this.logger.log(
      `Sub account created for ${driver.name}: ${subAccount.subAccountCode}`,
    );

    return subAccount.subAccountCode;
  }

  async listSubAccounts(): Promise<MonnifySubAccount[]> {
    return this.request<MonnifySubAccount[]>('get', '/api/v1/sub-accounts');
  }

  async findSubAccountByBankDetails(
    bankCode: string,
    accountNumber: string,
  ): Promise<MonnifySubAccount | null> {
    const subAccounts = await this.listSubAccounts();

    return (
      subAccounts.find(
        (subAccount) =>
          subAccount.bankCode === bankCode &&
          subAccount.accountNumber === accountNumber,
      ) ?? null
    );
  }

  async validateBankAccount(bankCode: string, accountNumber: string) {
    return this.request<{
      accountNumber: string;
      accountName: string;
      bankCode: string;
      currencyCode: string;
    }>('get', '/api/v1/disbursements/account/validate', undefined, {
      params: { bankCode, accountNumber },
    });
  }

  async initiateTransaction(params: {
    amount: number;
    tripId: string;
    ownerEmail: string;
    ownerName: string;
    driverSubAccountCode: string;
    driverSplitPercent: number;
  }): Promise<{ checkoutUrl: string; transactionReference: string; paymentReference: string }> {
    const contractCode = this.config.get<string>('MONNIFY_CONTRACT_CODE');

    // Strip hyphens from the UUID and append a base-36 timestamp to guarantee
    // uniqueness across retries while staying well under Monnify's 50-char limit.
    // Format: BICA-<32 hex chars>-<~8 base-36 chars> ≈ 46 chars max.
    const paymentReference = `BICA-${params.tripId.replace(/-/g, '')}-${Date.now().toString(36)}`;

    const payload = {
      amount: params.amount,
      customerName: params.ownerName,
      customerEmail: params.ownerEmail,
      paymentReference,
      paymentDescription: `BICA ride payment - Trip ${params.tripId}`,
      currencyCode: 'NGN',
      contractCode,
      redirectUrl: this.config.get<string>('MONNIFY_REDIRECT_URL') ?? 'https://bicadrive.app/payment/complete',
      paymentMethods: ['ACCOUNT_TRANSFER', 'CARD'],
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
      paymentReference,
    };
  }

  async verifyTransaction(transactionReference: string): Promise<{
    status: string;
    amountPaid: number;
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
      status: result.paymentStatus,
      amountPaid: result.amountPaid,
      paymentMethod: result.paymentMethod,
    };
  }

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
