import { useEffect, useState } from 'react';
import { useChannelList } from '../state/ChannelListContext';
import { useChatDockRequest } from '../state/ChatDockContext';
import { isChannelUnread } from '../lib/channels';
import { railAriaLabel, subLine } from '../components/chatRow';
import { ChatPane } from '../components/ChatPane';
import { ChallengeSheet } from '../components/ChallengeSheet';
import { OpponentPanel } from '../components/OpponentPanel';

const FILTERS = [
  ['all', 'All'],
  ['dm', 'Direct'],
  ['group', 'Groups'],
  ['tournament', 'Tournaments'],
  ['match', 'Matches'],
] as const;
type Filter = (typeof FILTERS)[number][0];

/** The full-page counterpart of the dock: inbox, conversation, opponent. */
export function ChatScreen() {
  const { channels, loadError, refresh, bumpActivity, bumpRead } = useChannelList();
  const { requestedChannelId, clearRequestedChannel } = useChatDockRequest();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [challengeTarget, setChallengeTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (requestedChannelId) refresh();
  }, [requestedChannelId, refresh]);
  useEffect(() => {
    if (!requestedChannelId || !channels) return;
    if (channels.some((c) => c.id === requestedChannelId)) {
      setSelectedId(requestedChannelId);
      clearRequestedChannel();
    }
  }, [requestedChannelId, channels, clearRequestedChannel]);

  const selected = channels?.find((c) => c.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && channels && !selected) setSelectedId(null);
  }, [selectedId, channels, selected]);

  const shown = (channels ?? []).filter((c) => filter === 'all' || c.kind === filter);
  const showPanel = selected && (selected.kind === 'dm' || selected.kind === 'match');

  return (
    <div className={`chat-screen${showPanel ? ' has-panel' : ''}`}>
      <section className="chat-inbox panel chamfer-9" aria-label="Conversations">
        <div className="seg-group" role="group" aria-label="Filter conversations">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn seg-btn${filter === id ? ' is-active' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {loadError && <p className="friend-notice" role="alert">{loadError}</p>}
        <ul className="chat-rail-list">
          {shown.length === 0 && <li className="text-muted">No conversations yet.</li>}
          {shown.map((c) => {
            const unread = isChannelUnread(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chat-rail-row${c.id === selectedId ? ' is-open' : ''}`}
                  data-kind={c.kind}
                  aria-label={railAriaLabel(c, unread)}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className="chat-rail-title max-w-full [overflow-wrap:anywhere]">{c.displayTitle}</span>
                  <span className="chat-rail-sub max-w-full text-faint [overflow-wrap:anywhere]">{subLine(c)}</span>
                  {unread && (
                    <span className="chat-rail-unread-tag" aria-hidden="true">
                      Unread
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="chat-conversation">
        {selected ? (
          <ChatPane
            key={selected.id}
            embedded
            channel={selected}
            minimized={false}
            onToggleMinimize={() => {}}
            onClose={() => {}}
            onActivity={bumpActivity}
            onRead={bumpRead}
            onChallenge={setChallengeTarget}
          />
        ) : (
          <p className="chat-empty panel chamfer-9 text-muted">Pick a conversation</p>
        )}
      </div>

      {showPanel && <OpponentPanel key={selected.id} channel={selected} onChallenge={setChallengeTarget} />}
      {challengeTarget && <ChallengeSheet target={challengeTarget} onClose={() => setChallengeTarget(null)} />}
    </div>
  );
}
