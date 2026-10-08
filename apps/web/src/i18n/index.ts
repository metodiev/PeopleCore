import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources.js';

const stored = typeof window !== 'undefined' ? window.localStorage.getItem('peoplecore.locale') : null;

void i18n.use(initReactI18next).init({
  resources,
  lng: stored ?? 'bg',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (language) => {
  if (typeof window !== 'undefined') window.localStorage.setItem('peoplecore.locale', language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
});

export default i18n;
