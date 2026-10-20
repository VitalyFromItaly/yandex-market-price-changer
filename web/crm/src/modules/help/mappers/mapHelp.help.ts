import type {
  Help,
  HelpBlock,
  HelpBlockResponse,
  HelpResponse,
  HelpSpan,
  HelpSpanResponse,
} from '../help.domain';

export function mapHelp(response: HelpResponse): Help {
  return {
    sections: response.sections.map((section) => ({
      title: section.title,
      blocks: section.blocks.map(mapBlock),
    })),
    supportContact: response.supportContact,
    supportUrl: telegramUrl(response.supportContact),
  };
}

function mapBlock(block: HelpBlockResponse): HelpBlock {
  switch (block.kind) {
    case 'text':
      return { kind: 'text', spans: block.spans.map(mapSpan) };
    case 'lines':
      return { kind: 'lines', items: block.items.map((item) => item.map(mapSpan)) };
    case 'list':
      return {
        kind: 'list',
        ordered: block.ordered === true,
        items: block.items.map((item) => item.map(mapSpan)),
      };
  }
}

function mapSpan(span: HelpSpanResponse): HelpSpan {
  if (typeof span === 'string') return { kind: 'text', text: span };
  if ('bold' in span) return { kind: 'bold', text: span.bold };
  return { kind: 'code', text: span.code };
}

/** `@nick` → https://t.me/nick. Что-то другое — без ссылки, а не битая ссылка. */
export function telegramUrl(contact: string): string | null {
  const match = /^@([A-Za-z0-9_]{5,32})$/.exec(contact.trim());
  return match === null ? null : `https://t.me/${match[1]}`;
}
