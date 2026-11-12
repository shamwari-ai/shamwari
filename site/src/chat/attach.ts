import type { Strings } from './strings';
import { sizeLabel } from './render';

/**
 * Attachments, phase 1: a file or a voice note is kept ON THIS DEVICE and goes nowhere. Nothing here makes a network request:
 * the file is read with the browser's own picker, a recording is made with MediaRecorder, and both stay in memory until the
 * question is sent, when the app stores them in IndexedDB (store.ts) next to the question, labelled "not sent". The text of
 * the question is all that is ever sent. There is no transcription and no reading of a file's contents.
 */
export interface Pending {
  id: string;
  kind: 'file' | 'voice';
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 4;
const MAX_VOICE_MS = 5 * 60_000;

const clock = (ms: number): string => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

interface Options {
  strings: () => Strings;
  /** A short message for the person (the page's status line). */
  say: (text: string) => void;
  newId: () => string;
  /** The pending list changed (the composer may need to resize). */
  changed?: () => void;
}

export interface Attach {
  /** What is waiting to be sent with the next question; emptied. */
  take(): Pending[];
  /** Forget what is waiting. */
  clear(): void;
  count(): number;
  /** Words changed (a language switch): redraw the chips. */
  refresh(): void;
}

export function initAttach(root: Document, o: Options): Attach {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const list = $('#attach-list');
  const menu = $('#plus-menu') as HTMLElement & { showPopover(): void; hidePopover(): void };
  const plus = $('#plus');
  const mic = $('#mic');
  const fileInput = $<HTMLInputElement>('#file-input');
  const pending: Pending[] = [];
  let recorder: MediaRecorder | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  /** Waiting for the browser's microphone permission: a second tap must not start a second recording. */
  let starting = false;
  /** Set by clear(): the recording that is stopping is thrown away, not added. */
  let discard = false;

  const draw = () => {
    const s = o.strings();
    list.hidden = pending.length === 0 && !recorder;
    list.replaceChildren(
      ...pending.map((p) => {
        const li = root.createElement('li');
        li.className = 'attach-chip';
        const name = root.createElement('span');
        name.className = 'attach-name';
        name.textContent = p.name;
        const meta = root.createElement('span');
        meta.className = 'attach-meta';
        meta.textContent = `${sizeLabel(p.size)} · ${s.attachKept}`;
        const rm = root.createElement('button');
        rm.type = 'button';
        rm.className = 'attach-remove';
        rm.setAttribute('aria-label', `${s.removeAttachment}: ${p.name}`);
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          pending.splice(pending.indexOf(p), 1);
          draw();
          o.changed?.();
          $('#q').focus();
        });
        li.append(name, meta, rm);
        return li;
      }),
    );
    if (recorder) {
      const li = root.createElement('li');
      li.className = 'attach-chip attach-recording';
      li.setAttribute('role', 'status');
      li.textContent = s.recordingNow;
      list.append(li);
    }
    const stop = recorder !== null;
    mic.setAttribute('aria-pressed', String(stop));
    mic.setAttribute('aria-label', stop ? s.stopRecording : s.recordVoice);
  };

  const add = (p: Pending): boolean => {
    if (pending.length >= MAX_FILES) {
      o.say(o.strings().tooManyFiles);
      return false;
    }
    if (p.size > MAX_BYTES) {
      o.say(o.strings().fileTooBig);
      return false;
    }
    pending.push(p);
    return true;
  };

  // ---- the "+" menu: Upload a file. (A skills entry will join it when Skills has something in it; until then it is not shown.)
  plus.addEventListener('click', () => {
    if (menu.matches(':popover-open')) return;
    const r = plus.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.round(r.left))}px`;
    menu.style.top = `${Math.round(r.top - 4)}px`;
    menu.showPopover();
    // Opens upward: the composer is at the bottom of the screen.
    const box = menu.getBoundingClientRect();
    menu.style.top = `${Math.max(8, Math.round(r.top - box.height - 4))}px`;
    menu.style.left = `${Math.max(8, Math.min(Math.round(r.left), Math.round(innerWidth - box.width - 8)))}px`;
    plus.setAttribute('aria-expanded', 'true');
    $('#plus-upload').focus();
  });
  menu.addEventListener('toggle', (e) => {
    if ((e as Event & { newState?: string }).newState === 'closed') plus.setAttribute('aria-expanded', 'false');
  });
  $('#plus-upload').addEventListener('click', () => {
    menu.hidePopover();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    for (const f of [...(fileInput.files ?? [])]) {
      if (!add({ id: o.newId(), kind: 'file', name: f.name || 'file', type: f.type || 'application/octet-stream', size: f.size, blob: f })) break;
    }
    fileInput.value = ''; // the same file can be chosen again
    draw();
    o.changed?.();
    $('#q').focus();
  });

  // ---- the microphone: a voice note, recorded and kept here. Nothing transcribes it.
  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  mic.hidden = !supported;
  const finish = (rec: MediaRecorder, chunks: Blob[], stream: MediaStream, started: number) => {
    clearTimeout(stopTimer);
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    if (chunks.length && !discard) {
      const type = rec.mimeType || chunks[0]!.type || 'audio/webm';
      const blob = new Blob(chunks, { type });
      add({ id: o.newId(), kind: 'voice', name: `${o.strings().voiceNote} ${clock(Date.now() - started)}`, type, size: blob.size, blob });
    }
    discard = false;
    draw();
    o.changed?.();
  };
  mic.addEventListener('click', async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    if (starting) return;
    // No room for another: say so before recording, not after.
    if (pending.length >= MAX_FILES) {
      o.say(o.strings().tooManyFiles);
      return;
    }
    starting = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      const started = Date.now();
      const mine = stream;
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => finish(rec, chunks, mine, started);
      discard = false;
      recorder = rec;
      rec.start();
      stopTimer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), MAX_VOICE_MS);
      draw();
    } catch {
      stream?.getTracks().forEach((t) => t.stop()); // never leave the microphone on
      recorder = null;
      o.say(o.strings().micDenied);
    } finally {
      starting = false;
    }
  });

  return {
    take: () => {
      const out = pending.splice(0);
      draw();
      return out;
    },
    clear: () => {
      pending.length = 0;
      if (recorder && recorder.state !== 'inactive') {
        discard = true;
        recorder.stop();
      }
      draw();
    },
    count: () => pending.length,
    refresh: draw,
  };
}
