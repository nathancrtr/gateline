import type { DiffFile } from '../api.ts'

function FileHeader({ file }: { file: DiffFile }) {
  const label = file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line bg-inset px-[13px] py-[9px]">
      <span className="min-w-0 truncate font-mono text-xs font-semibold">{label}</span>
      <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums">
        {file.status === 'binary' ? (
          <span className="text-muted">binary</span>
        ) : (
          <>
            <span className="text-ok">+{file.additions}</span> <span className="text-bad">−{file.deletions}</span>
            {file.status !== 'modified' && <span className="ml-2 text-muted">{file.status}</span>}
          </>
        )}
      </span>
    </div>
  )
}

export function DiffView({ files }: { files: DiffFile[] }) {
  if (files.length === 0) return <p className="py-8 text-center text-sm text-muted">No diff — the run branch matches the default branch.</p>
  return (
    <div className="flex flex-col gap-4">
      {files.map((file) => (
        <section key={`${file.oldPath}→${file.newPath}`} className="overflow-hidden rounded-[6px] border border-line bg-surface">
          <FileHeader file={file} />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-xs leading-5">
              <tbody>
                {file.hunks.map((hunk, hi) => (
                  <HunkRows key={hi} header={hunk.header} lines={hunk.lines} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function HunkRows({ header, lines }: { header: string; lines: DiffFile['hunks'][number]['lines'] }) {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-accent-soft px-3 py-[3px] text-[11px] text-accent">
          {header}
        </td>
      </tr>
      {lines.map((line, i) => {
        const bg = line.kind === 'add' ? 'bg-ok-soft' : line.kind === 'del' ? 'bg-bad-soft' : ''
        const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '
        return (
          <tr key={i} className={bg}>
            <td className="w-[44px] select-none border-r border-line px-2 py-0 text-right tabular-nums text-faint">{line.oldNo ?? ''}</td>
            <td className="w-[44px] select-none border-r border-line px-2 py-0 text-right tabular-nums text-faint">{line.newNo ?? ''}</td>
            <td className="whitespace-pre px-3 py-0">
              <span className="select-none text-faint">{sign} </span>
              {line.text}
            </td>
          </tr>
        )
      })}
    </>
  )
}
