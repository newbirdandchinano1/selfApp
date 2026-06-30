import type {
  ReviewBlock,
  ReviewFieldModel,
  ReviewTextModel,
  TextSelection,
} from '@/lib/review-journal-format';
import {
  removeImageBlock,
  toggleTodoCheckedAtLineStart,
  updateReviewTextModelPlain,
} from '@/lib/review-journal-format';
import { ReviewRichTextInput } from '@/components/review/review-rich-text-input';
import { Spacing } from '@/constants/design-tokens';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export type ReviewFieldEditorState = {
  blockIndex: number;
  selection: TextSelection;
};

type Props = {
  model: ReviewFieldModel;
  onChange: (model: ReviewFieldModel) => void;
  editorState: ReviewFieldEditorState;
  onEditorStateChange: (state: ReviewFieldEditorState) => void;
  controlledSelection?: TextSelection;
  onClearControlledSelection?: () => void;
  placeholder?: string;
  editable: boolean;
  textColor: string;
  placeholderColor: string;
  caretColor: string;
  backgroundColor: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export function ReviewFieldEditor({
  model,
  onChange,
  editorState,
  onEditorStateChange,
  controlledSelection,
  onClearControlledSelection,
  placeholder,
  editable,
  textColor,
  placeholderColor,
  caretColor,
  backgroundColor,
  containerStyle,
}: Props) {
  const updateTextBlock = useCallback(
    (blockIndex: number, nextModel: ReviewTextModel, selection?: TextSelection) => {
      const nextBlocks = model.blocks.map((block, idx) =>
        idx === blockIndex && block.kind === 'text' ? { kind: 'text' as const, model: nextModel } : block,
      );
      onChange({ blocks: nextBlocks });
      onEditorStateChange({
        blockIndex,
        selection: selection ?? editorState.selection,
      });
    },
    [editorState.selection, model.blocks, onChange, onEditorStateChange],
  );

  const handlePlainChange = useCallback(
    (blockIndex: number, current: ReviewTextModel, plain: string) => {
      onClearControlledSelection?.();
      updateTextBlock(blockIndex, updateReviewTextModelPlain(current, plain));
    },
    [onClearControlledSelection, updateTextBlock],
  );

  const handleToggleTodo = useCallback(
    (blockIndex: number, current: ReviewTextModel, markerStart: number) => {
      const result = toggleTodoCheckedAtLineStart(current, markerStart);
      updateTextBlock(blockIndex, result.model, result.selection);
      onClearControlledSelection?.();
    },
    [onClearControlledSelection, updateTextBlock],
  );

  const handleDeleteImage = useCallback(
    (blockIndex: number) => {
      const result = removeImageBlock(model, blockIndex);
      onChange(result.model);
      onEditorStateChange({
        blockIndex: result.focusBlockIndex,
        selection: result.selection,
      });
      onClearControlledSelection?.();
    },
    [model, onChange, onClearControlledSelection, onEditorStateChange],
  );

  return (
    <View style={[styles.root, containerStyle, { backgroundColor }]}>
      {model.blocks.map((block, blockIndex) => {
        if (block.kind === 'image') {
          return (
            <View key={`img-${blockIndex}-${block.uri}`} style={styles.imageWrap}>
              <Image source={{ uri: block.uri }} style={styles.image} contentFit="cover" />
              {editable ? (
                <Pressable
                  onPress={() => handleDeleteImage(blockIndex)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.imageDeleteBtn, { opacity: pressed ? 0.75 : 1 }]}>
                  <MaterialIcons name="close" size={16} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          );
        }

        const active = editorState.blockIndex === blockIndex;
        return (
          <ReviewRichTextInput
            key={`text-${blockIndex}`}
            model={block.model}
            onChangePlain={plain => handlePlainChange(blockIndex, block.model, plain)}
            onSelectionChange={selection => {
              onEditorStateChange({ blockIndex, selection });
              if (controlledSelection != null) onClearControlledSelection?.();
            }}
            onToggleTodoLine={lineStart => handleToggleTodo(blockIndex, block.model, lineStart)}
            controlledSelection={active ? controlledSelection : undefined}
            placeholder={blockIndex === 0 ? placeholder : undefined}
            textColor={textColor}
            placeholderColor={placeholderColor}
            caretColor={caretColor}
            containerStyle={styles.textBlock}
            inputStyle={styles.textInput}
            editable={editable}
            onFocus={() => onEditorStateChange({ blockIndex, selection: editorState.selection })}
          />
        );
      })}
    </View>
  );
}

export function getActiveTextBlock(model: ReviewFieldModel, blockIndex: number): ReviewTextModel | null {
  const block = model.blocks[blockIndex];
  if (!block || block.kind !== 'text') return null;
  return block.model;
}

export function updateFieldModelTextBlock(
  model: ReviewFieldModel,
  blockIndex: number,
  nextTextModel: ReviewTextModel,
): ReviewFieldModel {
  return {
    blocks: model.blocks.map((block, idx) =>
      idx === blockIndex && block.kind === 'text' ? { kind: 'text', model: nextTextModel } : block,
    ) as ReviewBlock[],
  };
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.md,
    borderRadius: 16,
    overflow: 'hidden',
  },
  textBlock: {
    minHeight: 120,
  },
  textInput: {
    minHeight: 120,
  },
  imageWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  imageDeleteBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
