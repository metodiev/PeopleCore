import { Injectable, Logger } from '@nestjs/common';

export interface SmsMessage {
  to: string;
  body: string;
}

/**
 * Outbound SMS gateway port.
 *
 * SMS is optional: the platform ships no SMS provider driver, so the bound
 * implementation is a documented no-op. It is enabled from the environment —
 * when `SMS_API_KEY` is not set the delivery path is skipped silently, and
 * when it is set the no-op adapter logs that no driver is installed. Deployments
 * that need SMS bind a real driver to this port instead.
 */
export abstract class SmsPort {
  abstract isConfigured(): boolean;
  abstract send(message: SmsMessage): Promise<void>;
}

@Injectable()
export class EnvironmentSmsPort extends SmsPort {
  private readonly logger = new Logger(EnvironmentSmsPort.name);

  isConfigured(): boolean {
    return Boolean(process.env['SMS_API_KEY']);
  }

  async send(message: SmsMessage): Promise<void> {
    this.logger.warn(
      `SMS delivery requested for ${maskPhone(message.to)} but no SMS provider driver is installed — skipping`,
    );
  }
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? '***' : `${phone.slice(0, 4)}***`;
}
