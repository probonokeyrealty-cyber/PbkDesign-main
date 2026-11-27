import { useEffect } from 'react';
import { useRuntimeSnapshot } from '../../src/app/hooks/useRuntimeSnapshot';

export function RuntimePollingProbe() {
  const { snapshot, refresh } = useRuntimeSnapshot(5000, true);
  useEffect(() => {
    Object.assign(window, { __runtimePollingSnapshot: snapshot, __runtimePollingRefresh: refresh });
    return () => {
      Reflect.deleteProperty(window, '__runtimePollingRefresh');
      Reflect.deleteProperty(window, '__runtimePollingSnapshot');
    };
  }, [snapshot, refresh]);
  return null;
}
