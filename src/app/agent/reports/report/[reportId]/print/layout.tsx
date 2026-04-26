import type { ReactNode } from 'react'

type PrintLayoutProps = {
  children: ReactNode
}

export default function PrintLayout({ children }: PrintLayoutProps) {
  return (
    <>
      {children}
      <style dangerouslySetInnerHTML={{ __html: `
        .print-shell .page {
          overflow: hidden !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }

        .print-shell .page-one {
          break-after: page !important;
          page-break-after: always !important;
        }

        .print-shell .page-two {
          break-after: auto !important;
          page-break-after: auto !important;
          position: static !important;
          padding-bottom: 22px !important;
        }

        .print-shell .footer-note {
          position: static !important;
          margin-top: 18px !important;
          border-top: 1px solid #eadbc9 !important;
          padding-top: 9px !important;
          font-size: 8px !important;
          line-height: 1.35 !important;
        }

        .print-shell table.transactions {
          font-size: 8.9px !important;
          line-height: 1.22 !important;
        }

        .print-shell .transactions th {
          padding: 5.5px 5px !important;
          font-size: 6.9px !important;
          letter-spacing: 0.55px !important;
          white-space: nowrap !important;
        }

        .print-shell .transactions td {
          padding: 5.2px 5px !important;
        }

        .print-shell .transactions strong {
          font-size: 8.95px !important;
        }

        .print-shell .transactions td span {
          font-size: 7.5px !important;
        }

        .print-shell .transactions th:nth-child(1),
        .print-shell .transactions td:nth-child(1) { width: 9% !important; }

        .print-shell .transactions th:nth-child(2),
        .print-shell .transactions td:nth-child(2) { width: 23% !important; }

        .print-shell .transactions th:nth-child(3),
        .print-shell .transactions td:nth-child(3) { width: 17% !important; }

        .print-shell .transactions th:nth-child(4),
        .print-shell .transactions td:nth-child(4) { width: 10.5% !important; }

        .print-shell .transactions th:nth-child(5),
        .print-shell .transactions td:nth-child(5) { width: 9.5% !important; }

        .print-shell .transactions th:nth-child(6),
        .print-shell .transactions td:nth-child(6) { width: 12.5% !important; }

        .print-shell .transactions th:nth-child(7),
        .print-shell .transactions td:nth-child(7) { width: 10% !important; }

        .print-shell .transactions th:nth-child(8),
        .print-shell .transactions td:nth-child(8) { width: 8.5% !important; }

        @media print {
          html, body {
            width: 210mm !important;
            margin: 0 !important;
            background: white !important;
          }

          .print-shell {
            padding: 0 !important;
          }

          .print-shell .page {
            width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            margin: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }

          .print-shell .page-one {
            break-after: page !important;
            page-break-after: always !important;
          }

          .print-shell .page-two {
            break-after: auto !important;
            page-break-after: auto !important;
          }
        }
      ` }} />
    </>
  )
}
