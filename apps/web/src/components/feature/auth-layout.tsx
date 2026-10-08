import type { ReactNode } from 'react';
import { Card, CardContent, CardFooter } from '../ui/card.js';
import { LanguageSwitcher } from '../language-switcher.js';
import { ThemeToggle } from '../theme-toggle.js';

/** Centered card layout shared by every unauthenticated screen. */
export function AuthLayout(props: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">PC</span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{props.title}</h1>
          {props.subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{props.subtitle}</p> : null}
        </div>
        <Card>
          <CardContent className="space-y-4">{props.children}</CardContent>
          {props.footer ? <CardFooter className="justify-center text-sm">{props.footer}</CardFooter> : null}
        </Card>
      </div>
    </div>
  );
}
