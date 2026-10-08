import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { actionEmail, copyFor, stripHtml, subjectFor } from './mail.templates.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface VerificationMailContext {
  recipientName: string;
  url: string;
  expiresInHours: number;
  locale?: string;
}

/**
 * Transactional email. `MAIL_DRIVER=console` (default in development) writes
 * messages to the log so flows like email verification can be completed
 * without an SMTP server; `MAIL_DRIVER=smtp` uses nodemailer.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.mail.driver === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: config.mail.smtp.host,
        port: config.mail.smtp.port,
        secure: config.mail.smtp.secure,
        auth:
          config.mail.smtp.user && config.mail.smtp.password
            ? { user: config.mail.smtp.user, pass: config.mail.smtp.password }
            : undefined,
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[mail:console] to=${message.to} subject="${message.subject}"`);
      this.logger.debug(message.text ?? stripHtml(message.html));
      return;
    }
    await this.transporter.sendMail({
      from: this.config.mail.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? stripHtml(message.html),
    });
  }

  async sendVerificationEmail(to: string, context: VerificationMailContext): Promise<void> {
    await this.send({
      to,
      subject: subjectFor(context.locale, 'verify'),
      html: actionEmail({
        title: copyFor(context.locale, 'verifyTitle'),
        body: copyFor(context.locale, 'verifyBody', context.recipientName, context.expiresInHours),
        actionLabel: copyFor(context.locale, 'verifyAction'),
        actionUrl: context.url,
      }),
    });
  }

  async sendPasswordResetEmail(to: string, context: VerificationMailContext): Promise<void> {
    await this.send({
      to,
      subject: subjectFor(context.locale, 'reset'),
      html: actionEmail({
        title: copyFor(context.locale, 'resetTitle'),
        body: copyFor(context.locale, 'resetBody', context.recipientName, context.expiresInHours),
        actionLabel: copyFor(context.locale, 'resetAction'),
        actionUrl: context.url,
      }),
    });
  }

  async sendInvitationEmail(to: string, context: VerificationMailContext & { companyName: string }): Promise<void> {
    await this.send({
      to,
      subject: subjectFor(context.locale, 'invite', context.companyName),
      html: actionEmail({
        title: copyFor(context.locale, 'inviteTitle', context.companyName),
        body: copyFor(context.locale, 'inviteBody', context.recipientName, context.expiresInHours),
        actionLabel: copyFor(context.locale, 'inviteAction'),
        actionUrl: context.url,
      }),
    });
  }

  async sendNotificationEmail(to: string, subject: string, body: string, actionUrl?: string): Promise<void> {
    await this.send({
      to,
      subject,
      html: actionEmail({
        title: subject,
        body,
        actionLabel: actionUrl ? 'Open PeopleCore' : undefined,
        actionUrl,
      }),
    });
  }
}
