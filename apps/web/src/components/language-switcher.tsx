import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button.js';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const next = i18n.language.startsWith('bg') ? 'en' : 'bg';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={next === 'bg' ? 'Превод на български' : 'Switch to English'}
      title={next === 'bg' ? 'BG' : 'EN'}
    >
      <Languages className="size-4" />
    </Button>
  );
}
