import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, Trash2, RotateCcw, Check, UserRound } from 'lucide-react';
import { Modal, useToast } from './ui.jsx';

/** Shrink any image to a JPEG data URL (max 600px) so uploads stay small. */
function toJpeg(source, w, h, max = 600) {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(toJpeg(img, img.naturalWidth, img.naturalHeight));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('That file is not a readable image'));
    img.src = URL.createObjectURL(file);
  });
}

function WebcamDialog({ onClose, onCapture }) {
  const video = useRef(null);
  const [stream, setStream] = useState(null);
  const [shot, setShot] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let s;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' }, audio: false })
      .then((st) => {
        s = st;
        setStream(st);
        if (video.current) video.current.srcObject = st;
      })
      .catch(() => setErr('Could not open the camera. Allow camera access in the browser, or upload a photo instead.'));
    if (!navigator.mediaDevices) setErr('Camera is not available. The app must be opened over https or on localhost to use the webcam.');
    return () => s?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (video.current && stream && !shot) video.current.srcObject = stream;
  }, [shot, stream]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // centre-crop to a 5:6 portrait like an ID photo
    const ratio = 5 / 6;
    let sw = v.videoWidth, sh = v.videoHeight;
    let cw = sh * ratio, ch = sh;
    if (cw > sw) { cw = sw; ch = sw / ratio; }
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(v, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, cw, ch);
    setShot(toJpeg(c, cw, ch));
  };

  return (
    <Modal
      title="Capture photo"
      onClose={onClose}
      footer={
        shot ? (
          <>
            <button className="btn" onClick={() => setShot(null)}><RotateCcw size={16} /> Retake</button>
            <button className="btn primary" onClick={() => { onCapture(shot); onClose(); }}><Check size={16} /> Use this photo</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={capture} disabled={!stream}><Camera size={16} /> Capture</button>
          </>
        )
      }
    >
      {err ? (
        <div className="alert warn">{err}</div>
      ) : (
        <div className="cam">{shot ? <img src={shot} alt="Captured" /> : <video ref={video} autoPlay playsInline muted />}</div>
      )}
    </Modal>
  );
}

/**
 * value: current photo URL or data URL. onChange(dataUrl | null).
 */
export default function PhotoPicker({ value, onChange }) {
  const input = useRef(null);
  const [cam, setCam] = useState(false);
  const toast = useToast();

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Choose an image file (JPG or PNG)', 'error');
    try {
      onChange(await fileToDataUrl(f));
    } catch (er) {
      toast(er.message, 'error');
    }
  };

  return (
    <div className="photo-picker">
      <div className="preview">{value ? <img src={value} alt="Employee" /> : <UserRound size={44} />}</div>
      <div className="stack" style={{ gap: 8 }}>
        <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
        <button type="button" className="btn sm" onClick={() => input.current.click()}>
          <Upload size={15} /> Upload / choose file
        </button>
        <button type="button" className="btn sm" onClick={() => setCam(true)}>
          <Camera size={15} /> Use webcam
        </button>
        {value && (
          <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>
            <Trash2 size={15} /> Remove
          </button>
        )}
        <span className="small muted">JPG or PNG, face clearly visible</span>
      </div>
      {cam && <WebcamDialog onClose={() => setCam(false)} onCapture={onChange} />}
    </div>
  );
}
