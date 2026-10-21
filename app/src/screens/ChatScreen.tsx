import { useEffect, useState } from 'react';
import { useChannelList } from '../state/ChannelListContext';
import { useChatDockRequest } from '../state/ChatDockContext';
import { isChannelUnread } from '../lib/channels';
import { ChatRailRow } from '../components/ChatRailRow';
import { useProfiles } from '../components/TrainerBits';
import { useSession } from '../state/SessionContext';
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
  const { user } = useSession();
  const profiles = useProfiles((channels ?? []).flatMap((c) => (c.otherId ? [c.otherId] : [])));

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

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (channels ?? []).filter((c) => (filter === 'all' || c.kind === filter) && (!q || c.displayTitle.toLowerCase().includes(q)));
  const showPanel = selected && (selected.kind === 'dm' || selected.kind === 'match');

  return (
    <div className={`chat-screen${showPanel ? ' has-panel' : ''}`}>
      <section className="chat-inbox panel chamfer-9" aria-label="Conversations">
        <input
          className="input"
          type="search"
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
          {channels === null && !loadError && <li className="text-muted" role="status">Loading conversations…</li>}
          {channels && shown.length === 0 && <li className="text-muted">{query ? 'No conversations match.' : 'No conversations yet.'}</li>}
          {shown.map((c) => (
            <li key={c.id}>
              <ChatRailRow c={c} unread={isChannelUnread(c)} open={c.id === selectedId} profile={c.otherId ? profiles.get(c.otherId) : undefined} me={user?.id} onOpen={() => setSelectedId(c.id)} />
            </li>
          ))}
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
