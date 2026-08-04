import { WishItemEditorScreen } from '@/components/wish-item-editor/WishItemEditorScreen';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

export default function EditWishItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';

  if (!itemId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少条目 ID</Text>
      </View>
    );
  }

  return <WishItemEditorScreen mode={{ kind: 'edit', id: itemId }} />;
}
