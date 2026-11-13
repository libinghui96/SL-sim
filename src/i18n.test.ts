import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES, TRANSLATIONS, getLocale, setLocale, t, type TranslationValues } from './i18n';

const han = /[\u3400-\u9fff]/;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const sources = import.meta.glob<string>(['./view/*.ts', '!./view/*.test.ts', './main.ts', '../index.html'], { query: '?raw', import: 'default', eager: true });

function expectCovered(text: string, file: string): void {
  const key = Object.hasOwn(TRANSLATIONS, text) ? text : text.trim();
  if (han.test(key)) expect(Object.hasOwn(TRANSLATIONS, key), `${file}: ${key}`).toBe(true);
}

beforeEach(() => {
  // Never read or overwrite a developer's real saved preference during a test.
  vi.stubGlobal('localStorage', undefined);
  vi.resetModules();
  setLocale('zh-CN');
});

afterEach(() => {
  setLocale('zh-CN');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('locale API', () => {
  it('switches in memory when storage is absent and translates placeholders', () => {
    vi.stubGlobal('localStorage', undefined);
    setLocale('en');
    expect(t('锅炉压力')).toBe('Boiler pressure');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: 2.5 })).toBe('Chest 2.5 kgf/cm²');
    setLocale('ja');
    expect(t('锅炉压力')).toBe('ボイラー圧力');
    setLocale('zh-CN');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: 0 })).toBe('汽室 0 kgf/cm²');
  });

  it('keeps unknown strings, missing placeholders and interpolation values literal', () => {
    setLocale('en');
    expect(t('unknown {value}', { value: '$& <script> {other}' })).toBe('unknown $& <script> {other}');
    expect(t('汽室 {pressure} kgf/cm²')).toBe('Chest {pressure} kgf/cm²');
    expect(t('toString')).toBe('toString');
    expect(t('__proto__')).toBe('__proto__');
  });

  it.each(LOCALES)('preserves unknown text and interpolates only own values in $value', ({ value }) => {
    setLocale(value);
    expect(t('尚未翻译的部件')).toBe('尚未翻译的部件');
    expect(t('')).toBe('');
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(t(key)).toBe(key);
    const values: TranslationValues = Object.assign(Object.create({ inherited: 'not a value' }), {
      zero: 0, empty: '', nil: null, missing: undefined, negative: -1.5,
      literal: '$& $1 <b> {zero}',
    });
    expect(t('{zero}|{zero}|{empty}|{nil}|{missing}|{inherited}|{negative}|{literal}', values))
      .toBe('0|0||{nil}|{missing}|{inherited}|-1.5|$& $1 <b> {zero}');
    expect(t('{constructor}|{toString}|{__proto__}', {})).toBe('{constructor}|{toString}|{__proto__}');
    expect(t('{__proto__}', { ['__proto__']: 'own value' })).toBe('own value');
    expect(t('{value}', Object.assign(Object.create(null), { value: 'null prototype' }))).toBe('null prototype');
  });

  it('preserves nullish known placeholders but accepts zero and empty text', () => {
    setLocale('en');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: undefined })).toBe('Chest {pressure} kgf/cm²');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: null })).toBe('Chest {pressure} kgf/cm²');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: 0 })).toBe('Chest 0 kgf/cm²');
    expect(t('汽室 {pressure} kgf/cm²', { pressure: '' })).toBe('Chest  kgf/cm²');
  });

  it('loads a saved locale, updates html lang, persists changes and unsubscribes', async () => {
    const storage = { getItem: vi.fn(() => 'ja'), setItem: vi.fn() };
    const document = { documentElement: { lang: '' } };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', document);
    const api = await import('./i18n');
    expect(api.getLocale()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    const listener = vi.fn();
    const unsubscribe = api.onLocaleChange(listener);
    api.setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    expect(storage.setItem).toHaveBeenLastCalledWith(api.LOCALE_STORAGE_KEY, 'en');
    expect(listener).toHaveBeenCalledExactlyOnceWith('en');
    api.setLocale('en');
    api.setLocale('unsupported');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(api.getLocale()).toBe('en');
    unsubscribe();
    api.setLocale('zh-CN');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(LOCALES)('restores $value after a reload', async ({ value }) => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => entries.get(key) ?? null),
      setItem: vi.fn((key: string, text: string) => { entries.set(key, text); }),
    };
    const document = { documentElement: { lang: '' } };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', document);
    const api = await import('./i18n');
    const listener = vi.fn();
    api.onLocaleChange(listener);
    expect(listener).not.toHaveBeenCalled();
    api.setLocale(value);
    // An explicit selection must persist even when it matches the Chinese default.
    expect(storage.setItem).toHaveBeenLastCalledWith(api.LOCALE_STORAGE_KEY, value);
    vi.resetModules();
    const reloaded = await import('./i18n');
    expect(storage.getItem).toHaveBeenLastCalledWith(api.LOCALE_STORAGE_KEY);
    expect(reloaded.getLocale()).toBe(value);
    expect(document.documentElement.lang).toBe(value);
  });

  it('ignores a corrupt stored locale and survives read and write failures', async () => {
    const storage = {
      getItem: vi.fn(() => 'not-a-locale'),
      setItem: vi.fn(() => { throw new Error('QuotaExceededError'); }),
    };
    vi.stubGlobal('localStorage', storage);
    let api = await import('./i18n');
    expect(api.getLocale()).toBe('zh-CN');
    expect(() => api.setLocale('ja')).not.toThrow();
    expect(api.getLocale()).toBe('ja');
    vi.resetModules();
    storage.getItem.mockImplementation(() => { throw new Error('SecurityError'); });
    api = await import('./i18n');
    expect(api.getLocale()).toBe('zh-CN');
    expect(() => api.setLocale('en')).not.toThrow();
    expect(api.t('水位')).toBe('Water');
  });

  it('switches and notifies when accessing the storage property itself throws', async () => {
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new Error('SecurityError'); },
    });
    const document = { documentElement: { lang: '' } };
    vi.stubGlobal('document', document);
    const api = await import('./i18n');
    expect(api.getLocale()).toBe('zh-CN');
    const listener = vi.fn();
    const unsubscribe = api.onLocaleChange(listener);
    expect(() => api.setLocale('en')).not.toThrow();
    expect(api.t('进汽总管')).toBe('Steam inlet manifold');
    expect(document.documentElement.lang).toBe('en');
    expect(listener).toHaveBeenCalledExactlyOnceWith('en');
    unsubscribe();
    unsubscribe();
    api.setLocale('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid requested locales', () => {
    setLocale('ja');
    setLocale('fr');
    expect(getLocale()).toBe('ja');
  });

  it('does not persist, notify or change html lang for invalid locale requests', async () => {
    const storage = { getItem: vi.fn(() => 'ja'), setItem: vi.fn() };
    const document = { documentElement: { lang: '' } };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', document);
    const api = await import('./i18n');
    const listener = vi.fn();
    api.onLocaleChange(listener);
    for (const invalid of ['', 'EN', 'en-US', 'zh', 'ja-JP', '__proto__']) api.setLocale(invalid);
    expect(api.getLocale()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('changes only captured text nodes and attributes, preserving embedded controls', async () => {
    const labelText = { nodeType: 3, textContent: '\n 暂停 ' };
    const input = { nodeType: 1, checked: true, value: '37' };
    const staticElement = { childNodes: [input, labelText] };
    const attrs = new Map([['aria-label', '收起或展开面板']]);
    const attrElement = {
      dataset: { i18nAttrs: 'aria-label' },
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
    };
    const root = {
      querySelectorAll: (selector: string) => selector === '[data-i18n]' ? [staticElement] : [attrElement],
    } as unknown as ParentNode;
    const api = await import('./i18n');
    const unbind = api.bindStaticText(root);
    api.setLocale('en');
    expect(labelText.textContent).toBe('\n Pause ');
    expect(attrs.get('aria-label')).toBe('Collapse or expand panel');
    expect(staticElement.childNodes[0]).toBe(input);
    expect(input.checked).toBe(true);
    expect(input.value).toBe('37');
    api.setLocale('ja');
    expect(labelText.textContent).toBe('\n 一時停止 ');
    api.setLocale('zh-CN');
    expect(labelText.textContent).toBe('\n 暂停 ');
    unbind();
    api.setLocale('en');
    expect(labelText.textContent).toBe('\n 暂停 ');
  });

  it('translates newly bound phase-board text immediately under a saved locale', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'ja', setItem: vi.fn() });
    const heading = { nodeType: 3, textContent: '相位监视' };
    const whitespace = { nodeType: 3, textContent: '\n ' };
    const attrs = new Map([['aria-label', '轴泵行程比例'], ['title', '第三动轴']]);
    const element = {
      childNodes: [whitespace, heading],
      dataset: { i18nAttrs: '  aria-label  title  missing  ' },
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
    };
    const root = { querySelectorAll: () => [element] } as unknown as ParentNode;
    const api = await import('./i18n');
    const unbind = api.bindStaticText(root);
    expect(heading.textContent).toBe('位相モニター');
    expect(attrs.get('aria-label')).toBe('軸動ポンプ行程比');
    expect(attrs.get('title')).toBe('第3動軸');
    api.setLocale('en');
    expect(heading.textContent).toBe('Phase monitor');
    expect(attrs.get('aria-label')).toBe('Pump stroke fraction');
    expect(attrs.get('title')).toBe('Third driving axle');
    expect(attrs.has('missing')).toBe(false);
    expect(whitespace.textContent).toBe('\n ');
    unbind();
    api.setLocale('zh-CN');
    expect(heading.textContent).toBe('Phase monitor');
    expect(attrs.get('title')).toBe('Third driving axle');
  });
});

describe('translation coverage', () => {
  it('has nonempty English/Japanese entries and matching placeholders for every source', () => {
    for (const [source, translations] of Object.entries(TRANSLATIONS)) {
      expect(han.test(translations[0]), `Chinese left in English translation: ${source}`).toBe(false);
      for (const translation of translations) {
        expect(translation.trim(), source).not.toBe('');
        expect(placeholders(translation), source).toEqual(placeholders(source));
      }
    }
  });

  it('covers Chinese source literals in all view files, including shared part and flow labels', () => {
    expect(sources['./view/phaseBoard.ts']).toBeTruthy();
    for (const [file, source] of Object.entries(sources)) {
      if (!file.endsWith('.ts')) continue;
      // Both quote styles, including accessible attribute values inside template HTML.
      for (const match of source.matchAll(/'((?:\\.|[^'\\\r\n])*)'|"((?:\\.|[^"\\\r\n])*)"/g)) {
        expectCovered(match[1] ?? match[2], file);
      }
    }
  });

  it('covers marked static HTML inside view templates, especially the phase board', () => {
    const phaseKeys: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      if (!file.endsWith('.ts')) continue;
      for (const match of source.matchAll(/<[^<>]*\bdata-i18n(?=[\s=>])[^<>]*>([^<>]*)</g)) {
        // Interpolated labels (e.g. the two side headings) are checked as source literals above.
        if (match[1].includes('${')) continue;
        expectCovered(match[1], file);
        if (file === './view/phaseBoard.ts') phaseKeys.push(match[1].trim());
      }
    }
    expect(phaseKeys).toContain('相位监视');
    expect(phaseKeys).toContain('位移：中位为零、向前为正；汽口仅表示几何开闭。');
  });

  it.each(LOCALES)('renders pipe, pump and live-value keys in $value', ({ value }) => {
    setLocale(value);
    const partKeys = [
      '进汽总管', '左汽室', '右汽室', '左右汽室', '气缸排汽总管', '独立通风喷嘴',
      '轴泵偏心轮', '轴泵连杆', '轴泵柱塞', '吸水单向阀', '出水单向阀', '第三动轴', '烟箱管路连接',
    ];
    const readouts: Array<[string, TranslationValues]> = [
      ['给水 {flow} g/s', { flow: '0.00' }],
      ['旁通回水 {flow} g/s', { flow: '0.25' }],
      ['饱和蒸汽 {flow} g/s', { flow: '0.20' }],
      ['通风 {flow} g/s', { flow: '0.05' }],
      ['排汽 {flow} g/s', { flow: '0.20' }],
      ['酒精 {flow} mL/min', { flow: '1.5' }],
      ['传给水 {power} W', { power: 450 }],
      ['过热器 +{temperature} K', { temperature: 0 }],
      ['第 {axle} 动轴 · 轴泵', { axle: 3 }],
      ['相位 {angle}° · 行程 {percent}%', { angle: '90.0', percent: 50 }],
    ];
    for (const [key, values] of [...partKeys.map(key => [key, {}] as [string, TranslationValues]), ...readouts]) {
      expectCovered(key, 'model / flow / phase contract');
      const template = value === 'zh-CN' ? key : TRANSLATIONS[key][value === 'en' ? 0 : 1];
      const expected = template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
      const rendered = t(key, values);
      expect(rendered).toBe(expected);
      expect(placeholders(rendered)).toEqual([]);
      if (value === 'en') expect(han.test(rendered)).toBe(false);
      if (value !== 'zh-CN') expect(rendered).not.toBe(key);
    }
  });

  it('covers every Chinese static HTML label and accessible name except native language names', () => {
    const html = sources['../index.html'];
    const names = new Set(['简体中文', '日本語']);
    for (const match of html.matchAll(/>([^<>]+)</g)) {
      const key = match[1].trim();
      if (han.test(key) && !names.has(key)) expect(Object.hasOwn(TRANSLATIONS, key), key).toBe(true);
    }
    for (const match of html.matchAll(/(?:aria-label|title)="([^"]+)"/g)) {
      if (han.test(match[1])) expect(Object.hasOwn(TRANSLATIONS, match[1]), match[1]).toBe(true);
    }
  });
});