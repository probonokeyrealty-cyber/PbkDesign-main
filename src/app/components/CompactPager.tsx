import { ChevronLeft, ChevronRight } from 'lucide-react';

export const OPERATOR_LIST_PAGE_SIZE = 10;

type CompactPagerProps = {
  page: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  pageSize?: number;
  itemLabel?: string;
  className?: string;
};

export function getPageSlice<T>(items: T[], page: number, pageSize = OPERATOR_LIST_PAGE_SIZE) {
  const safePage = Math.max(0, page);
  return items.slice(safePage * pageSize, safePage * pageSize + pageSize);
}

export function CompactPager({
  page,
  total,
  label,
  onPageChange,
  pageSize = OPERATOR_LIST_PAGE_SIZE,
  itemLabel = 'items',
  className = '',
}: CompactPagerProps) {
  const safeTotal = Math.max(0, total);
  const pageCount = Math.max(1, Math.ceil(safeTotal / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safeTotal ? safePage * pageSize + 1 : 0;
  const end = Math.min(safeTotal, (safePage + 1) * pageSize);

  return (
    <nav
      className={`pbk-list-pager ${className}`.trim()}
      aria-label={label}
      data-list-page-size={pageSize}
    >
      <span className="pbk-list-pager-status">
        Page {safePage + 1} of {pageCount} · {start}-{end} of {safeTotal} {itemLabel}
      </span>
      <div className="pbk-list-pager-actions">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, safePage - 1))}
          disabled={safePage <= 0}
          aria-label={`Previous ${itemLabel} page`}
        >
          <ChevronLeft size={15} />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pageCount - 1, safePage + 1))}
          disabled={safePage >= pageCount - 1}
          aria-label={`Next ${itemLabel} page`}
        >
          Next
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}
