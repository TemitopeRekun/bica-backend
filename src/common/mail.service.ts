import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private resend: Resend | null = null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY is not defined. Emails will be logged to console instead.');
    }
  }

  async sendVerificationOtp(email: string, name: string, otp: string) {
    const subject = 'Your Bica Verification Code';
    const html = this.buildEmail({
      preheader: `${otp} is your Bica verification code. It expires in 10 minutes.`,
      title: `Welcome to Bica, ${name.split(' ')[0]}!`,
      body: `You're almost there. Use the 6-digit code below to verify your email address and activate your account.`,
      otp,
      footerNote: `If you didn't create a Bica account, you can safely ignore this email. Someone may have entered your address by mistake.`,
    });

    await this.sendMail(email, subject, html, otp);
  }

  async sendPasswordResetOtp(email: string, name: string, otp: string) {
    const subject = 'Reset Your Bica Password';
    const html = this.buildEmail({
      preheader: `${otp} is your Bica password reset code. It expires in 10 minutes.`,
      title: `Password Reset Request`,
      body: `Hi ${name.split(' ')[0]}, we received a request to reset the password for your Bica account. Use the code below to proceed. This code expires in <strong>10 minutes</strong>.`,
      otp,
      footerNote: `If you didn't request a password reset, please ignore this email. Your password will remain unchanged. If you're concerned about your account security, contact our support team.`,
    });

    await this.sendMail(email, subject, html, otp);
  }

  /**
   * Builds a consistent, branded HTML email template for all OTP communications.
   */
  private buildEmail(opts: {
    preheader: string;
    title: string;
    body: string;
    otp: string;
    footerNote: string;
  }): string {
    const digits = opts.otp.split('').map(d => `
      <td style="width:44px;height:56px;text-align:center;vertical-align:middle;
                 background:#F8F7FF;border:2px solid #EDEDF5;border-radius:10px;
                 font-size:28px;font-weight:800;color:#0A0A23;letter-spacing:0;
                 font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        ${d}
      </td>
      <td style="width:8px;"></td>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Bica</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</span>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#1A0533;border-radius:14px;padding:12px 24px;">
                    <span style="font-size:22px;font-weight:900;color:#FFFFFF;letter-spacing:-0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                      BICA<span style="color:#A78BFA;">.</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#FFFFFF;border-radius:20px;padding:40px 36px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

              <!-- Title -->
              <p style="margin:0 0 8px 0;font-size:22px;font-weight:800;color:#0A0A23;line-height:1.3;">
                ${opts.title}
              </p>

              <!-- Body -->
              <p style="margin:0 0 32px 0;font-size:15px;color:#6B6B8A;line-height:1.6;">
                ${opts.body}
              </p>

              <!-- OTP Digits -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px auto;">
                <tr>
                  ${digits}
                </tr>
              </table>

              <!-- Expiry Notice -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#FFF8EC;border:1px solid #FFE4A3;border-radius:10px;padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#92600A;font-weight:600;text-align:center;">
                      ⏱ This code expires in <strong>10 minutes</strong>. Do not share it with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #EDEDF5;margin:0 0 24px 0;" />

              <!-- Footer Note -->
              <p style="margin:0;font-size:12px;color:#9B9BB8;line-height:1.6;text-align:center;">
                ${opts.footerNote}
              </p>
            </td>
          </tr>

          <!-- Bottom Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#9B9BB8;">
                &copy; ${new Date().getFullYear()} Bica Drive. All rights reserved.
              </p>
              <p style="margin:4px 0 0 0;font-size:11px;color:#C4C4D4;">
                This is an automated message — please do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private async sendMail(to: string, subject: string, html: string, otp: string) {
    if (this.resend) {
      try {
        const { data, error } = await this.resend.emails.send({
          from: 'Bica <notifications@bicadriver.com>',
          to,
          subject,
          html,
        });

        if (error) {
          this.logger.error(`Resend Error: ${error.message}`);
          this.logger.log(`[FALLBACK] OTP for ${to}: ${otp}`);
        } else {
          this.logger.log(`✅ Email sent to ${to}. ID: ${data?.id}`);
        }
      } catch (err) {
        this.logger.error(`Failed to send email: ${err.message}`);
        this.logger.log(`[FALLBACK] OTP for ${to}: ${otp}`);
      }
    } else {
      this.logger.log(`[DEV MODE] OTP for ${to} → ${otp}`);
    }
  }
}
