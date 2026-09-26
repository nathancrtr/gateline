// The contact-surface-scoped diff (#270). What replaced the flat unified-diff
// renderer, per FRONTEND.md §4.1: not a better diff — the host's is better and
// always will be — but a diff arranged around something no host knows, the
// `file_contact_surface` each work item declared before the work began.
//
// Presence, not verdicts. The view says a changed file falls under no declared
// surface. It does not say that is wrong: surfaces widen legitimately through
// an architect amendment or a gate human's call, and weighing it is the
// approver's job and the Reviewer's `Boundary check` section. So the callout is
// stated in plain declarative words and nothing renders as an error.
//
// Scoping is never truncation. Every file in the diff renders, whether or not
// any item claimed it, and a run with no readable task set gets the plain diff
// with a one-line reason rather than an unlabelled one posing as labelled.
import type { DiffFile, SurfaceItemRef, SurfaceScopedDiff } from '../api.ts'
import { arrangeDiff, fileLabel, totals } from '../surface.ts'
import { Withheld } from './vocabulary.tsx'

export function DiffView({ files, surface }: { files: DiffFile[]; surface?: SurfaceScopedDiff }) {
  if (files.length === 0) return <p className="py-8 text-center text-sm text-muted">No diff — the run branch matches the default branch.</p>

  const { undeclared, groups } = arrangeDiff(files, surface)
  const grouped = groups.length > 0 || undeclared.length > 0
  const sum = totals(files)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="font-ui text-[11px] text-muted">{grouped ? 'diff by declared contact surface' : 'diff'}</p>
        <span className="font-ui text-[11px] text-faint">
          {sum.files} file{sum.files === 1 ? '' : 's'} · <span className="text-ok">+{sum.additions}</span>{' '}
          <span className="text-bad">−{sum.deletions}</span>
        </span>
      </div>

      {/* Contracts are forkable, and a run may legitimately carry no task set at
          all. Either way the diff still renders — it is a G2 artifact — but it
          renders unlabelled, saying what it looked for and did not find. */}
      {surface?.withheld && (
        <Withheld
          view="Contact-surface grouping withheld"
          reason={{ sentence: surface.withheld }}
          after="The full diff is below, in git's order."
          data-surface-withheld
        />
      )}

      {/* The undeclared files lead. Not because they are worse, but because a
          boundary the approver has to go looking for is not a check. */}
      {undeclared.length > 0 && (
        <section data-undeclared>
          <div className="mb-2 border border-warn-line bg-warn-bg px-2.5 py-2">
            <p className="text-[12.5px] font-medium leading-[1.5] text-warn">
              {undeclared.length} changed file{undeclared.length === 1 ? '' : 's'} outside every declared contact surface
            </p>
            <p className="mt-1 text-[12px] leading-[1.5] text-muted">
              No work item in this run declared it would touch {undeclared.length === 1 ? 'this file' : 'these files'}. Whether that is a
              boundary breach or an amendment the plan already carries is the Reviewer's{' '}
              <span className="font-mono text-[11.5px]">Boundary check</span> and yours.
            </p>
          </div>
          <div className="flex flex-col gap-4">
            {undeclared.map((file) => (
              <FileDiff key={`${file.oldPath}→${file.newPath}`} file={file} />
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <SurfaceSection key={group.item.id} item={group.item} files={group.files} />
      ))}

      {/* Nothing to group by, so the diff is simply the diff — the withheld
          case, and the run that committed no task set at all. */}
      {!grouped && (
        <div className="flex flex-col gap-4">
          {files.map((file) => (
            <FileDiff key={`${file.oldPath}→${file.newPath}`} file={file} />
          ))}
        </div>
      )}
    </div>
  )
}

/** One work item's declared surface, and the changed files falling under it. */
function SurfaceSection({ item, files }: { item: SurfaceItemRef; files: DiffFile[] }) {
  const untouched = item.surface.filter((entry) => !files.some((f) => f.newPath === entry || f.oldPath === entry))
  return (
    <section data-surface-group={item.id}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line pb-1.5">
        <span className="font-mono text-[12px] font-semibold text-ink">{item.id}</span>
        <span className="min-w-0 truncate text-[12.5px] text-muted">{item.title}</span>
        <span className="ml-auto shrink-0 font-ui text-[11px] text-faint">{item.statusText}</span>
      </div>
      <p className="mb-2 font-ui text-[11px] leading-[1.6] text-faint">
        declared: {item.surface.join(', ') || '(nothing)'}
        {untouched.length > 0 && <span className="text-muted"> · unchanged in this diff: {untouched.join(', ')}</span>}
      </p>
      <div className="flex flex-col gap-4">
        {files.map((file) => (
          <FileDiff key={`${file.oldPath}→${file.newPath}`} file={file} />
        ))}
      </div>
    </section>
  )
}

function FileHeader({ file }: { file: DiffFile }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line bg-inset px-[13px] py-[9px]">
      <span className="min-w-0 truncate font-mono text-xs font-semibold">{fileLabel(file)}</span>
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

function FileDiff({ file }: { file: DiffFile }) {
  return (
    <section className="overflow-hidden border border-line bg-surface">
      <FileHeader file={file} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs leading-5">
          <tbody>
            {file.hunks.map((hunk) => (
              <HunkRows key={hunk.header} header={hunk.header} lines={hunk.lines} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
          // biome-ignore lint/suspicious/noArrayIndexKey: a diff line has no natural id (old/new line numbers are null on "no newline" meta lines); this is a fixed, never-reordered render of one hunk.
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
