const COPY = {
  en: {
    verifyTitle: 'Confirm your email address',
    verifyBody: (name: string, hours: number) =>
      `Hi ${name}, welcome to PeopleCore. Confirm your email address to activate your account. The link expires in ${hours} hours.`,
    verifyAction: 'Confirm email',
    verifySubject: 'Confirm your PeopleCore email',
    resetTitle: 'Reset your password',
    resetBody: (name: string, hours: number) =>
      `Hi ${name}, we received a request to reset your password. The link expires in ${hours} hours. If you did not request this, you can ignore this message.`,
    resetAction: 'Reset password',
    resetSubject: 'Reset your PeopleCore password',
    inviteTitle: (company: string) => `You are invited to ${company} on PeopleCore`,
    inviteBody: (name: string, hours: number) =>
      `Hi ${name}, your account is ready. Set your password to get started. The invitation expires in ${hours} hours.`,
    inviteAction: 'Set your password',
    inviteSubject: (company: string) => `Invitation to ${company} on PeopleCore`,
  },
  bg: {
    verifyTitle: 'Потвърдете имейл адреса си',
    verifyBody: (name: string, hours: number) =>
      `Здравейте ${name}, добре дошли в PeopleCore. Потвърдете имейл адреса си, за да активирате профила си. Линкът е валиден ${hours} часа.`,
    verifyAction: 'Потвърждаване',
    verifySubject: 'Потвърдете имейла си в PeopleCore',
    resetTitle: 'Възстановяване на парола',
    resetBody: (name: string, hours: number) =>
      `Здравейте ${name}, получихме заявка за смяна на паролата. Линкът е валиден ${hours} часа. Ако не сте заявили смяна, игнорирайте това съобщение.`,
    resetAction: 'Нова парола',
    resetSubject: 'Възстановяване на парола в PeopleCore',
    inviteTitle: (company: string) => `Поканени сте в ${company} в PeopleCore`,
    inviteBody: (name: string, hours: number) =>
      `Здравейте ${name}, профилът ви е готов. Задайте парола, за да започнете. Поканата е валидна ${hours} часа.`,
    inviteAction: 'Задайте парола',
    inviteSubject: (company: string) => `Покана за ${company} в PeopleCore`,
  },
} as const;

type Locale = keyof typeof COPY;

function localeOf(locale?: string): Locale {
  return locale === 'bg' ? 'bg' : 'en';
}

export function subjectFor(locale: string | undefined, kind: 'verify' | 'reset' | 'invite', companyName = ''): string {
  const copy = COPY[localeOf(locale)];
  if (kind === 'verify') return copy.verifySubject;
  if (kind === 'reset') return copy.resetSubject;
  return copy.inviteSubject(companyName);
}

export function copyFor(
  locale: string | undefined,
  key: 'verifyTitle' | 'verifyBody' | 'verifyAction' | 'resetTitle' | 'resetBody' | 'resetAction' | 'inviteTitle' | 'inviteBody' | 'inviteAction',
  a = '',
  b = 0,
): string {
  const copy = COPY[localeOf(locale)] as Record<string, string | ((x: string, y: number) => string)>;
  const value = copy[key];
  if (typeof value === 'function') return value(a, b);
  return value ?? '';
}

export function actionEmail(input: {
  title: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
}): string {
  const button =
    input.actionLabel && input.actionUrl
      ? `<p style="margin:24px 0"><a href="${input.actionUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${input.actionLabel}</a></p>
         <p style="color:#6b7280;font-size:13px;word-break:break-all">${input.actionUrl}</p>`
      : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f9fafb;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
      <h1 style="font-size:20px;margin:0 0 16px;color:#111827">${input.title}</h1>
      <p style="color:#374151;line-height:1.6;margin:0">${input.body}</p>
      ${button}
      <p style="color:#9ca3af;font-size:12px;margin-top:32px">PeopleCore · HR platform</p>
    </div>
  </body></html>`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
