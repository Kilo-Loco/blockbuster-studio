import { useState } from 'react';
import { Button } from './ui';

function textInputClass() {
  return 'w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50';
}

/** The Hugging Face token field a gated download needs. Used on Settings → Models (right on the group that's
 *  waiting) and in the VideoSetup dialog. The downloader picks a saved token up within ~15 s
 *  (docker/download_models.py), so no restart is needed. */
/** `stepsAbove`: the caller already explains where to get a token (the VideoSetup dialog's steps), so the
 *  hint only says what happens after saving. */
export function GatedTokenField({ saved, onSave, stepsAbove }: { saved: boolean; onSave: (token: string) => void; stepsAbove?: boolean }) {
  const [value, setValue] = useState('');
  const save = () => {
    if (!value.trim()) return;
    onSave(value.trim());
    setValue('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={saved ? 'Token saved; paste a new one to replace it' : 'Hugging Face token (hf_…)'}
          className={textInputClass()}
        />
        <Button size="sm" variant="primary" disabled={!value.trim()} onClick={save}>
          Save
        </Button>
      </div>
      <p className="text-[11px] text-[var(--color-ink-3)]">
        {saved
          ? 'Token saved. If the download still waits, check that this account accepted the terms; it retries every few minutes.'
          : stepsAbove
            ? 'The download starts within a few seconds of saving.'
            : 'Create a read token at huggingface.co/settings/tokens with the account that accepted the terms. The download starts within a few seconds of saving.'}
      </p>
    </div>
  );
}
