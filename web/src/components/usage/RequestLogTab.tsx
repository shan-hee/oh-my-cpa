import React from 'react';
import { Button, Segmented } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { DownloadOutlined } from '../icons';
import { api, apiErrorCode } from '../../api/client';
import { useT } from '../../i18n';
import { isDemoMode } from '../../types/demoMode';
import { canPreviewLog, MAX_LOG_PREVIEW_BYTES } from '../../types/logs';
import {
  formatLogPayload,
  parseRequestLog,
  type RequestLogBlock,
  type RequestLogSection,
  type RequestLogSide,
} from '../../types/requestLog';
import { saveBlob } from '../../utils/download';
import { formatBytes } from '../../utils/format';
import { CopyButton } from '../common/CopyButton';
import { ParagraphPlaceholder } from '../common/ContentPlaceholder';
import { EmptyState } from '../common/EmptyState';
import { LoadFailure, Notice } from '../feedback';
import logStyles from '../logs/Logs.module.css';
import styles from './RequestLogTab.module.css';

/** One body or stream event, open on arrival and foldable out of the way. */
const Payload: React.FC<{ label: string; text: string }> = ({ label, text }) => {
  const [isOpen, setIsOpen] = React.useState(true);
  const size = React.useMemo(() => formatBytes(new TextEncoder().encode(text).length), [text]);
  const formatted = React.useMemo(() => formatLogPayload(text), [text]);
  return (
    <details className={styles.payload} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>
        <span>{label}</span>
        <span className={styles['payload-size']}>{size}</span>
      </summary>
      {isOpen && <pre className={styles['payload-text']} tabIndex={0}>{formatted}</pre>}
    </details>
  );
};

function renderBlock(block: RequestLogBlock, index: number): React.ReactNode {
  switch (block.kind) {
    case 'field':
      return (
        <div key={index} className={styles.field}>
          <span className={styles['field-name']}>{block.name}</span>
          <span className={styles['field-value']}>{block.value}</span>
        </div>
      );
    case 'label':
      return <div key={index} className={styles.label}>{block.text}</div>;
    case 'payload':
      return <Payload key={index} label={block.label} text={block.text} />;
    default:
      return <div key={index} className={styles.text}>{block.text}</div>;
  }
}

const Sections: React.FC<{ sections: RequestLogSection[] }> = ({ sections }) => (
  <>
    {sections.map((section, index) => (
      <section key={index} className={styles.section}>
        <h4 className={styles['section-title']}>{section.title}</h4>
        <div className={styles['section-body']}>{section.blocks.map(renderBlock)}</div>
      </section>
    ))}
  </>
);

export interface RequestLogTabProps {
  eventId: number;
  requestId?: string;
  hasRequestLog: boolean;
  /** The pane stays mounted once visited; only the visible one reads the file. */
  isActive: boolean;
}

/**
 * One record's CPA request log read inside the request detail.
 *
 * Every read is audited and quotes request content, so the file is fetched only while the tab is
 * showing, saved from that same copy, and dropped when the pane goes away.
 */
export const RequestLogTab: React.FC<RequestLogTabProps> = ({ eventId, requestId, hasRequestLog, isActive }) => {
  const t = useT();
  const isDemo = isDemoMode();
  const isAvailable = hasRequestLog && Boolean(requestId) && !isDemo;
  const [side, setSide] = React.useState<RequestLogSide>('request');

  const query = useQuery({
    queryKey: ['usage-event-request-log', eventId],
    queryFn: async () => {
      const blob = await api.downloadUsageEventRequestLog(eventId);
      return canPreviewLog(blob.size) ? { blob, text: await blob.text() } : { blob, text: undefined };
    },
    enabled: isAvailable && isActive,
    meta: { silent: true },
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const text = query.data?.text;
  const sections = React.useMemo(() => (text ? parseRequestLog(text) : []), [text]);

  if (isDemo) return <Notice tone="info" title={t('demo.blocked')} />;
  if (!isAvailable) return <EmptyState size="compact" title={t('events.log_unavailable')} />;
  if (query.isPending) return <ParagraphPlaceholder rows={10} />;
  if (query.isError) {
    return apiErrorCode(query.error) === 'request_log_not_found'
      ? <Notice tone="warning" title={t('logs.viewer_missing')} description={t('logs.viewer_missing_desc')} />
      : <LoadFailure title={t('logs.viewer_failed')} error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { blob } = query.data;
  const fileName = `${(requestId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')}.log`;
  let body: React.ReactNode;
  if (text === undefined) {
    body = <Notice tone="info" title={t('logs.viewer_too_large', { limit: formatBytes(MAX_LOG_PREVIEW_BYTES) })} />;
  } else if (text.trim() === '') {
    body = <EmptyState size="compact" title={t('logs.viewer_empty')} />;
  } else if (sections.length === 0) {
    body = <pre className={logStyles['viewer-text']} tabIndex={0}>{text}</pre>;
  } else {
    // Keyed by record and side so an opened payload does not carry over to another one.
    body = <Sections key={`${eventId}-${side}`} sections={sections.filter((section) => section.side === side)} />;
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {sections.length > 0 && (
          <Segmented
            value={side}
            options={[
              { value: 'request', label: t('events.raw_log_request') },
              { value: 'response', label: t('events.raw_log_response') },
            ]}
            onChange={(value) => setSide(value as RequestLogSide)}
          />
        )}
        <div className={styles.actions}>
          <CopyButton showLabel size="middle" text={text ?? ''} disabled={!text} />
          <Button icon={<DownloadOutlined />} onClick={() => saveBlob(blob, fileName)}>
            {t('logs.download')}
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
};
