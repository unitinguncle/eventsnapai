import { create } from 'zustand';

interface PhotoResult {
  objectId: string;
  thumbUrl: string;
  fullUrl: string;
}

interface VisitorState {
  searchResults: {
    myPhotos: PhotoResult[];
    generalPhotos: PhotoResult[];
    favoritePhotos: PhotoResult[];
  } | null;
  setSearchResults: (results: VisitorState['searchResults']) => void;
  clearResults: () => void;
}

export const useVisitorStore = create<VisitorState>((set) => ({
  searchResults: null,
  setSearchResults: (results) => set({ searchResults: results }),
  clearResults: () => set({ searchResults: null }),
}));
