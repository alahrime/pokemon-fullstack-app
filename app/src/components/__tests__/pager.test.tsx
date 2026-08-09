import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { Pager, pageList, PAGE_SIZES } from '../Pager';
import { RankingsScreen } from '../../screens/RankingsScreen';
import { BestTeams } from '../BestTeams';

/**
 * One pager, for every paged list.
 *
 * There were three, all prev/next only, so reaching page 40 of the rankings
 * took forty clicks and the page size was whatever the file said. This adds
 * numbered jumps and a size control, and puts a copy above the list as well as
 * below it.
 */

describe('which page numbers are drawn', () => {
  it('keeps a fixed width by eliding the middle', () => {
    // 46 pages of rankings as 46 buttons is a smear, not a control.
    expect(pageList(22, 46)).toEqual([0, null, 19, 20, 21, 22, 23, 24, 25, null, 45]);
  });

  it('slides the run inward at the ends rather than clipping it', () => {
    // From page 1 a run of three offers barely more reach than the next arrow.
    expect(pageList(0, 46)).toEqual([0, 1, 2, 3, 4, 5, 6, null, 45]);
    expect(pageList(45, 46)).toEqual([0, null, 39, 40, 41, 42, 43, 44, 45]);
    // Same length wherever it sits, so the strip does not change height as you
    // page — at nine the widest arrangement folded the size control onto a
    // second line and stepped the list below it down by 38px.
    const run = (p: number) => pageList(p, 46).filter((n) => n !== null).length;
    expect([run(0), run(4), run(22), run(41), run(45)].every((n) => n <= 9)).toBe(true);
  });

  it('spells out a gap of exactly one rather than eliding it', () => {
    // An ellipsis hiding a single page is wider than the page it hides, so
    // page 4 is drawn rather than replaced by "···".
    // A run of seven centred on 5 leaves exactly one page clear at each end.
    expect(pageList(5, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Two or more hidden pages do elide.
    expect(pageList(0, 11)).toEqual([0, 1, 2, 3, 4, 5, 6, null, 10]);
    expect(pageList(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('handles the degenerate counts without inventing pages', () => {
    expect(pageList(0, 1)).toEqual([0]);
    expect(pageList(0, 0)).toEqual([0]);
    expect(pageList(0, 2)).toEqual([0, 1]);
  });
});

describe('the pager', () => {
  const setup = (over = {}) => {
    const onPage = vi.fn();
    const onSize = vi.fn();
    const { container } = renderApp(
      <Pager page={0} pages={46} total={1140} size={25} onPage={onPage} onSize={onSize} {...over} />,
    );
    return { container, onPage, onSize };
  };

  it('jumps straight to a page rather than walking to it', () => {
    const { container, onPage } = setup();
    const last = [...container.querySelectorAll('.pager-num')].at(-1) as HTMLButtonElement;
    expect(last.textContent).toBe('46');
    fireEvent.click(last);
    expect(onPage).toHaveBeenCalledWith(45);
  });

  it('marks the current page for a pointer and a screen reader alike', () => {
    const { container } = setup({ page: 2 });
    const on = container.querySelector('.pager-num.is-on')!;
    expect(on.textContent).toBe('3');
    expect(on.getAttribute('aria-current')).toBe('page');
  });

  it('offers a choice of page size', () => {
    const { container, onSize } = setup();
    const select = container.querySelector('.pager-size-input') as HTMLSelectElement;
    expect([...select.options].map((o) => Number(o.value))).toEqual([...PAGE_SIZES]);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onSize).toHaveBeenCalledWith(100);
  });

  it('shows a size the caller chose even when it is not one of the offered ones', () => {
    // The opponent board opens at 16 to suit its grid. A select with no
    // matching option renders the first one, so the control claimed "10" while
    // 16 rows were on screen.
    const { container } = setup({ size: 16 });
    const select = container.querySelector('.pager-size-input') as HTMLSelectElement;
    expect(select.value).toBe('16');
    expect([...select.options].map((o) => Number(o.value))).toEqual([10, 16, 25, 50, 100]);
  });

  it('says which window it is showing', () => {
    const { container } = setup({ page: 2 });
    expect(container.querySelector('.pager-range')!.textContent).toContain('51–75');
    expect(container.querySelector('.pager-range')!.textContent).toContain('1,140');
  });

  it('does not offer to step past either end', () => {
    const first = setup({ page: 0 }).container;
    expect((first.querySelector('[aria-label="Previous page"]') as HTMLButtonElement).disabled).toBe(true);
    const last = setup({ page: 45 }).container;
    expect((last.querySelector('[aria-label="Next page"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders nothing for a single page with no size control', () => {
    const { container } = renderApp(
      <Pager page={0} pages={1} total={4} size={25} onPage={() => {}} />,
    );
    expect(container.querySelector('.pager')).toBeNull();
  });

  it('counts an empty list from zero rather than from one', () => {
    const { container } = renderApp(
      <Pager page={0} pages={1} total={0} size={25} onPage={() => {}} onSize={() => {}} />,
    );
    expect(container.querySelector('.pager-range')!.textContent).toContain('0–0');
  });
});

describe('every paged list uses it, above as well as below', () => {
  it('the rankings carry one at each end of the table', () => {
    const { container } = renderApp(<RankingsScreen />);
    const pagers = [...container.querySelectorAll('.pager')];
    expect(pagers).toHaveLength(2);
    expect(pagers[0].classList.contains('pager-top')).toBe(true);
    // The top one precedes the table in document order, which is what stops a
    // reader scrolling past 25 rows to change which 25 they are reading.
    const table = container.querySelector('.rankings-table')!;
    expect(pagers[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('changing the size re-pages the rankings from the top', () => {
    const { container } = renderApp(<RankingsScreen />);
    fireEvent.click([...container.querySelectorAll('.pager-num')].find((n) => n.textContent === '3')!);
    expect(container.querySelector('.pager-num.is-on')!.textContent).toBe('3');
    fireEvent.change(container.querySelector('.pager-size-input')!, { target: { value: '100' } });
    expect(container.querySelector('.pager-num.is-on')!.textContent).toBe('1');
    expect(container.querySelectorAll('.rank-row').length).toBe(100);
  });

  it('the discovered-teams list carries one at each end too', () => {
    const { container } = renderApp(<BestTeams league="great" size={3} onLoad={() => {}} />);
    const pagers = [...container.querySelectorAll('.pager')];
    expect(pagers.length).toBeGreaterThanOrEqual(1);
    expect(pagers[0].classList.contains('pager-top')).toBe(true);
  });
});
