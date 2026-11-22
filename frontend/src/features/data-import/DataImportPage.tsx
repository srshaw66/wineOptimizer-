// Data import section — isolated for further development.
// Self-contained: the rest of the app only knows this page's default export (loaded lazily),
// and it talks to the backend import API directly (/api/imports/*), not to the map or sensor code.
import ImportPanel from './ImportPanel';
import './import.css';

interface Props {
  siteId: string;
  siteName: string;
  apiAvailable: boolean;
  onBack: () => void;
}

export default function DataImportPage({siteId, siteName, apiAvailable, onBack}: Props) {
  return (
    <section className="page-overlay" aria-labelledby="data-import-title">
      <div className="page-head">
        <div>
          <p className="eyebrow">Data import · in development</p>
          <h1 id="data-import-title">Import observations</h1>
          <p>
            Preview a CSV or Excel workbook, review column mappings and warnings, then confirm to save the
            observations to the local database for <b>{siteName}</b> (block <code>teaching-plot</code>).
            Imported records are not shown on the map yet.
          </p>
        </div>
        <button type="button" className="btn" onClick={onBack}>Back to map</button>
      </div>
      {apiAvailable
        ? <ImportPanel vineyardId={siteId} />
        : <div className="state state--empty"><p>Importing needs the local API, which is not reachable right now. Start the backend, then use <b>Retry connection</b>.</p></div>}
    </section>
  );
}
