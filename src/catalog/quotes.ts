/**
 * Joseph Campbell quotations used as epigraphs in the interface.
 *
 * CRITICAL DIFFERENCE FROM mythology.ts, and it governs everything here:
 * mythology.json holds OUR SUMMARIES of what Campbell wrote. This file holds
 * HIS VERBATIM WORDS. Four consequences follow, none of them optional:
 *
 *  1. `text` is never paraphrased, tidied, shortened or translated. A
 *     quotation a reader cannot check against the cited passage is not a
 *     quotation. Where a line is excerpted mid-sentence the ellipsis is part
 *     of the text and `trimmed` says so.
 *  2. Every entry ships with its source visible in the UI, not merely
 *     recorded here — the licence basis in provenance.ts is "used with
 *     authorization, cited per entry", and an uncited epigraph would make
 *     that claim untrue.
 *  3. Nothing in this file may ever be fed to the language model. llm.ts
 *     builds its prompt from SkyContext; if quotes were added to that
 *     context a small model would paraphrase Campbell's prose as its own
 *     output, which is precisely the misattribution the citation discipline
 *     exists to prevent. Keep quotes on the render path only.
 *  4. Only Campbell's own words belong here. Lines he quoted approvingly
 *     from others — Black Elk, Novalis, the Rig Veda — belong to their
 *     authors and are excluded.
 *
 * Deliberately three entries, fixed to their positions, with no rotation and
 * no selection logic. A quote that changes under the reader turns a curated
 * line into obvious filler; scarcity is what keeps these feeling authored
 * rather than like a fortune-cookie machine.
 */
export interface QuoteEntry {
  /** Verbatim. English. Never edited, never translated. */
  text: string;
  /** Rendered inside <cite>. */
  work: string;
  /** Edition, page, or episode — enough for a reader to actually find it. */
  workDetail: string;
  /** True when excerpted from a longer sentence; the ellipsis is in `text`. */
  trimmed: boolean;
}

/** Closes the About page, above the personal note. */
export const ABOUT_CLOSING_QUOTE: QuoteEntry = {
  text: "Follow your bliss and don't be afraid, and doors will open where you didn't know they were going to be.",
  work: "The Power of Myth",
  workDetail: "1988, p. 120",
  trimmed: false,
};

/** Introduces the data-sources section, where the four cited Campbell works
 *  are listed directly beneath it. */
export const ABOUT_SOURCES_QUOTE: QuoteEntry = {
  text: "Myth is the secret opening through which the inexhaustible energies of the cosmos pour into human cultural manifestation.",
  work: "The Hero with a Thousand Faces",
  workDetail: '1949, Prologue, "The Monomyth"',
  trimmed: false,
};

/** Footer of an exported observing session — costs no screen space at all,
 *  and lands where someone is looking back over their own evening. */
export const EXPORT_FOOTER_QUOTE: QuoteEntry = {
  text: "…a planet that is whirling without end around the fireball of a star.",
  work: "The Power of Myth",
  workDetail: 'TV series, 1988, Ep. 3 "The First Storytellers"',
  trimmed: true,
};

/**
 * Renders a quote in the app's existing epigraph style. `lang="en"` is
 * load-bearing rather than decorative: it stops a screen reader in a
 * Japanese or French session pronouncing English text with the wrong voice.
 */
export function renderQuoteFigure(quote: QuoteEntry, langNote: string): string {
  return `
    <figure class="about-quote">
      <blockquote lang="en"><p>${quote.text}</p></blockquote>
      <figcaption>
        &mdash;&#8202;Joseph Campbell, <cite>${quote.work}</cite>, ${quote.workDetail}
        ${langNote ? `<span class="quote-lang-note">${langNote}</span>` : ""}
      </figcaption>
    </figure>
  `;
}

/** Plain-text form for the Markdown export. */
export function renderQuoteMarkdown(quote: QuoteEntry): string {
  return `> ${quote.text}\n> — Joseph Campbell, *${quote.work}*, ${quote.workDetail}`;
}
