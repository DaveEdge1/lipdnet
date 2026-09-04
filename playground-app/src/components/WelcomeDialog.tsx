interface Props {
  onClose: () => void
}

// First-run "what's new" overlay for the Playground, shown in-page (not a
// window.open popup, which ad/popup blockers suppress). Content mirrors the
// beta release brief, weighted toward NOAA conversion. (PANGAEA import is
// built but not yet exposed — keep it out of the splash until it ships.)
export function WelcomeDialog({ onClose }: Props) {
  return (
    <div className="welcome-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="welcome-card" role="dialog" aria-labelledby="welcome-title" aria-modal="true">
        <button className="welcome-close" onClick={onClose} aria-label="Close">×</button>

        <span className="welcome-eyebrow">What&rsquo;s new · Beta</span>
        <h2 id="welcome-title">Welcome to the LiPD Playground</h2>
        <p className="welcome-dek">
          Open, create, edit, validate, and visualize LiPD files right in your browser — including
          one-click conversion of NOAA archive data into editable datasets.
        </p>

        <div className="welcome-body">
          <h3>Import from NOAA</h3>
          <p>
            The headline feature: turn records from the NOAA NCEI Paleoclimatology archive into ready-to-edit
            LiPD datasets with one action. Behind the scenes the Playground calls <strong>PyleoTUPS</strong>,
            LinkedEarth&rsquo;s Python toolkit, to parse the source files; it then assembles a valid LiPD
            dataset — location, publications, investigators, units, and one measurement table per data table —
            and opens it in the editor. Because the parsing runs in PyleoTUPS rather than the browser, the
            Playground handles source formats a browser parser never could.
          </p>
          <p>
            Paste a study ID or URL, or search by keyword with filters for investigator, archive type,
            a lat/long box, and a year range. The conversion carries across coordinates (reordered to
            LiPD&rsquo;s lon/lat/elevation order), site name and elevation, publications, investigators, and
            every column with its variable name and units; missing-value sentinels like <code>-999</code>
            become true nulls, and a multi-table study becomes multiple measurement tables. Crucially, the
            <strong> older non-standard files</strong> work too: the GRIP 8.2&nbsp;ka study (<code>NOAA 6085</code>) —
            a page of prose followed by three stacked isotope tables — imports as three clean tables with their
            real column names. Proprietary formats (fire-scar <code>.fhx</code>, tree-ring <code>.rwl</code>)
            can&rsquo;t become a data table by any general tool, so the study&rsquo;s metadata imports with an empty
            starter table you fill in. You can also open a local NOAA <code>.txt</code> file, and export any
            open dataset back to the NOAA template.
          </p>

          <h3>Also new</h3>
          <p>
            A rebuilt four-panel workspace that resizes, collapses, and remembers your layout, with a
            zoomable structure view, time-series plots, and a site map. Three ways to <strong>create a
            dataset</strong> — from an existing <code>.lpd</code> template, from a pasted or uploaded data
            table, or from a blank slate via a guided form checked against the LiPDverse vocabulary.
            Spreadsheet-friendly editing (copy/paste with Excel or Google Sheets, CSV/TSV up- and download,
            add/delete columns), live validation, and rebuilt Query and Merge pages.
          </p>
        </div>

        <div className="welcome-actions">
          <button className="btn" onClick={onClose}>Got it — let&rsquo;s go</button>
        </div>
      </div>
    </div>
  )
}
