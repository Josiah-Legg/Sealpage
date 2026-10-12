/** Sealmark: the plain-text markup stored inside an encrypted .slpg file. */
export { parseMarkup, markupVersion } from './parse';
export { serializeMarkup, MARKUP_VERSION, MARKUP_HEADER } from './serialize';
export { parseInline, serializeInline } from './inline';
