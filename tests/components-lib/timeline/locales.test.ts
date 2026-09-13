import moment from 'moment';
import { describe, expect, it } from 'vitest';

import {
  getTimelineLocale,
  setMomentLocale,
  TIMELINE_LOCALES,
} from '../../../src/components-lib/timeline/locales';

describe('timeline locales', () => {
  describe('getTimelineLocale', () => {
    it('should default to en when null or undefined', () => {
      expect(getTimelineLocale(null)).toBe('en');
      expect(getTimelineLocale(undefined)).toBe('en');
    });

    it('should map pt-BR variations to pt_BR', () => {
      expect(getTimelineLocale('pt_BR')).toBe('pt_BR');
      expect(getTimelineLocale('pt-BR')).toBe('pt_BR');
      expect(getTimelineLocale('pt-br')).toBe('pt_BR');
    });

    it('should map pt and pt-PT to pt', () => {
      expect(getTimelineLocale('pt')).toBe('pt');
      expect(getTimelineLocale('pt-PT')).toBe('pt');
      expect(getTimelineLocale('pt-pt')).toBe('pt');
    });

    it('should pass through other language codes', () => {
      expect(getTimelineLocale('de')).toBe('de');
      expect(getTimelineLocale('fr')).toBe('fr');
      expect(getTimelineLocale('it')).toBe('it');
    });
  });

  describe('TIMELINE_LOCALES', () => {
    it('should contain Portuguese and English definitions', () => {
      expect(TIMELINE_LOCALES['en']).toBeDefined();
      expect(TIMELINE_LOCALES['en'].current).toBe('current');
      expect(TIMELINE_LOCALES['pt_BR']).toBeDefined();
      expect(TIMELINE_LOCALES['pt_BR'].current).toBe('atual');
      expect(TIMELINE_LOCALES['pt']).toBeDefined();
      expect(TIMELINE_LOCALES['pt-br']).toBeDefined();
      expect(TIMELINE_LOCALES['pt-BR']).toBeDefined();
    });
  });

  describe('setMomentLocale', () => {
    it('should format months and weekdays in Portuguese', () => {
      setMomentLocale('pt-br');

      // Fixed date: Monday, September 14, 2026
      const date = moment('2026-09-14T10:00:00Z');

      expect(date.format('dddd')).toBe('segunda-feira');
      expect(date.format('MMMM')).toBe('setembro');
      expect(date.format('D MMMM')).toBe('14 setembro');
    });
  });
});
