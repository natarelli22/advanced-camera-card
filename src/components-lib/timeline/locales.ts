import moment from 'moment';
import 'moment/locale/ca.js';
import 'moment/locale/de.js';
import 'moment/locale/fr.js';
import 'moment/locale/it.js';
import 'moment/locale/pl.js';
import 'moment/locale/pt-br.js';
import 'moment/locale/pt.js';
import 'moment/locale/sk.js';

export const TIMELINE_LOCALES = {
  pt: { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  pt_BR: { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  'pt-br': { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  'pt-BR': { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  pt_PT: { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  'pt-pt': { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  'pt-PT': { current: 'atual', time: 'data', deleteSelected: 'Apagar selecionado' },
  ca: { current: 'actual', time: 'hora', deleteSelected: 'Eliminar seleccionats' },
  sk: { current: 'aktuálny', time: 'čas', deleteSelected: 'Vymazať vybrané' },
};

export const getTimelineLocale = (lang?: string | null): string => {
  if (!lang) {
    return 'en';
  }
  const normalized = lang.replace('_', '-').toLowerCase();
  if (normalized === 'pt-br') {
    return 'pt_BR';
  }
  if (normalized === 'pt-pt' || normalized === 'pt') {
    return 'pt';
  }
  return lang;
};

export const setMomentLocale = (locale: string): void => {
  moment.locale(locale);
};

