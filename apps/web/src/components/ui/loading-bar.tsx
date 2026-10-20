import { useEffect, useState } from 'react';

export function LoadingBar({
  active,
  label = 'Loading',
  as: Tag = 'div',
}: {
  active: boolean;
  label?: string;
  as?: 'div' | 'span';
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const delay = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(delay);
  }, [active]);
  return (
    <Tag className="loading-track" aria-hidden={!visible}>
      {visible && <span className="loading-bar" role="progressbar" aria-label={label} />}
    </Tag>
  );
}
