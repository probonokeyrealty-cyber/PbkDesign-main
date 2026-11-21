import type { Dispatch, SetStateAction } from 'react';

const supportedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const maxBytes = 10_000_000;

export type QueuedPacketFile = {
  id: string;
  file: File;
  rights: string;
  alt: string;
  error?: string;
};

type AttachedPacketFile = {
  id: string;
  title: string;
  kind: 'packet' | 'photo';
  rights?: string;
};

function needsAttention({ file, rights, alt }: QueuedPacketFile) {
  if (!supportedTypes.includes(file.type) || file.size === 0 || file.size > maxBytes)
    return 'Choose a PDF, JPG, PNG or WebP above 0 bytes and up to 10 MB.';
  if (!rights.trim()) return 'Record media rights.';
  if (file.type !== 'application/pdf' && !alt.trim()) return 'Describe the photo.';
  return '';
}

export default function PacketFiles({
  propertyLabel,
  assets,
  files,
  setFiles,
  busy,
  dirty,
  onUpload,
}: {
  propertyLabel: string;
  assets: AttachedPacketFile[];
  files: QueuedPacketFile[];
  setFiles: Dispatch<SetStateAction<QueuedPacketFile[]>>;
  busy: boolean;
  dirty: boolean;
  onUpload: () => void;
}) {
  function change(id: string, field: 'rights' | 'alt', value: string) {
    setFiles((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    );
  }

  return (
    <section className="portal-panel portal-packet-files" aria-labelledby="portal-packet-files">
      <div className="portal-line">
        <h2 id="portal-packet-files">Packet files</h2>
        <span className="portal-chip">{assets.length} attached</span>
      </div>
      <p>{propertyLabel}</p>
      <p>
        Attach a PDF and photos to this private draft. Review and release a new version to share the
        files with approved investors.
      </p>
      <h3>Attached to this property</h3>
      {assets.length ? (
        <ul className="portal-packet-list">
          {assets.map((asset) => (
            <li key={asset.id} className="portal-line">
              <strong>{asset.title}</strong>
              <span>{asset.kind === 'packet' ? 'PDF' : 'Photo'}</span>
              <span>
                {asset.rights?.trim() ? 'Rights recorded' : 'Rights missing · review required'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No files attached yet.</p>
      )}
      <label>
        Choose packet files
        <input
          type="file"
          multiple
          accept={supportedTypes.join(',')}
          disabled={busy}
          aria-describedby="portal-packet-file-types"
          onChange={(event) => {
            const additions = Array.from(event.currentTarget.files ?? [], (file) => ({
              id: crypto.randomUUID(),
              file,
              rights: '',
              alt: '',
            }));
            setFiles((current) => [...current, ...additions]);
            event.currentTarget.value = '';
          }}
        />
      </label>
      <p id="portal-packet-file-types">PDF, JPG, PNG or WebP up to 10 MB per file.</p>
      {files.length > 0 && (
        <>
          <h3>Waiting to upload</h3>
          <div className="portal-packet-queue">
            {files.map((entry) => {
              const attention = needsAttention(entry);
              return (
                <fieldset key={entry.id} disabled={busy}>
                  <legend>{entry.file.name}</legend>
                  <div className="portal-grid">
                    <label>
                      Rights basis and rights holder
                      <input
                        maxLength={1000}
                        required
                        value={entry.rights}
                        onChange={(event) => change(entry.id, 'rights', event.target.value)}
                      />
                    </label>
                    {entry.file.type.startsWith('image/') && (
                      <label>
                        Photo alt text
                        <input
                          maxLength={400}
                          required
                          value={entry.alt}
                          onChange={(event) => change(entry.id, 'alt', event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="portal-line">
                    <span>
                      {attention || (entry.error ? 'Retry available' : 'Ready to upload')}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((current) => current.filter((file) => file.id !== entry.id))
                      }
                    >
                      Remove from queue
                    </button>
                  </div>
                  {entry.error && (
                    <p role="alert" className="portal-error">
                      {entry.error}
                    </p>
                  )}
                </fieldset>
              );
            })}
          </div>
          {dirty && <p>Save draft changes before uploading.</p>}
          <div className="portal-actions">
            <button
              type="button"
              className="portal-primary"
              disabled={busy || dirty || files.some(needsAttention)}
              onClick={onUpload}
            >
              Upload private files
            </button>
          </div>
          <p>Upload or remove queued files before previewing the packet.</p>
        </>
      )}
    </section>
  );
}
