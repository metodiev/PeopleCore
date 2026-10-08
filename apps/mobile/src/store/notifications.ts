import { create } from 'zustand';

interface NotificationsState {
  /** Incremented when a push arrives so open lists can refresh. */
  revision: number;
  unread: number | null;
  bump: () => void;
  setUnread: (unread: number | null) => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  revision: 0,
  unread: null,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
  setUnread: (unread) => set({ unread }),
}));
