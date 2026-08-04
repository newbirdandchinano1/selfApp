import { WishItemEditorScreen } from '@/components/wish-item-editor/WishItemEditorScreen';

export default function AddWishItemScreen() {
  return <WishItemEditorScreen mode={{ kind: 'create' }} />;
}
