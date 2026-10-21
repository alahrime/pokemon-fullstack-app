import type { ChannelDisplay } from '../lib/channels';
import type { Profile } from '../lib/profile';
import { capCount, railAriaLabel, subLine } from './chatRow';
import { TrainerAvatar, presenceLabel } from './TrainerBits';
import { usePresence } from '../lib/presence';

/**
 * One conversation in an inbox — the dock's rail and the Chat screen share it.
 * The avatar is the other trainer for a DM, an initial for anything else; the
 * preview is the newest message, prefixed "You:" when it was yours.
 */
export function ChatRailRow({ c, unread, open, profile, me, onOpen }: {
  c: ChannelDisplay; unread: boolean; open: boolean; profile: Profile | undefined; me: string | undefined; onOpen: () => void;
}) {
  const status = usePresence(c.otherId);
  const count = c.unreadCount ?? 0;
  const preview = c.lastPreview ? `${c.lastPreview.authorId === me ? 'You: ' : ''}${c.lastPreview.body}` : null;
  return (
    <button
      type="button"
      className={`chat-rail-row${open ? ' is-open' : ''}${unread ? ' is-unread' : ''}`}
      data-kind={c.kind}
      aria-label={`${railAriaLabel(c, unread)}${status ? `, ${presenceLabel(status).toLowerCase()}` : ''}`}
      onClick={onOpen}
    >
      <TrainerAvatar profile={c.otherId ? profile : undefined} name={c.displayTitle} size={40} userId={c.otherId} />
      <span className="chat-rail-text">
        <span className="chat-rail-title">{c.displayTitle}</span>
        {preview && <span className="chat-rail-preview">{preview}</span>}
        <span className="chat-rail-sub text-faint">{subLine(c)}</span>
      </span>
      {unread && (
        <span className={`chat-rail-unread-tag${count > 0 ? ' is-count' : ''}`} aria-hidden="true">
          {count > 0 ? capCount(count) : 'Unread'}
        </span>
      )}
    </button>
  );
}
