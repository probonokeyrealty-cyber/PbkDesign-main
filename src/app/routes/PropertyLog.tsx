import { useState } from 'react';
import { useBlocker } from 'react-router';
import { InvestorWorkspace, PortalConfirm } from '../investor/InvestorWorkspace';
export function PropertyLog() {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);
  return (
    <>
      <InvestorWorkspace staffMode onDirtyChange={setDirty} />
      {blocker.state === 'blocked' && (
        <PortalConfirm
          text="Discard unsaved property changes and leave this page?"
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        />
      )}
    </>
  );
}
