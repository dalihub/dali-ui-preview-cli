// hello-dali.preview.dali.cpp
//
// Welcome to DALi Preview! This is your first preview file.
//
// • Save (Ctrl+S) — the preview re-renders automatically
// • Edit anything below the `return` statement and watch the preview update
// • This file uses the `.preview.dali.cpp` naming convention so the
//   extension recognises it as a preview source
//
// The preview canvas can be resized in the webview panel — the layout
// recomputes for the new dimensions.

return FlexLayout::New()
    .SetDirection(FlexDirection::COLUMN)
    .SetAlignItems(FlexAlign::CENTER)
    .SetJustifyContent(FlexJustify::CENTER)
    .SetRequestedWidth(MATCH_PARENT)
    .SetRequestedHeight(MATCH_PARENT)
    .SetBackgroundColor(UiColor(0x1e1e2e))
    .Children({
        Label::New("Hello, Dali!")
            .SetFontSize(48)
            .SetTextColor(UiColor(0xFFFFFF)),

        Label::New("Edit this file to see the preview update")
            .SetFontSize(18)
            .SetTextColor(UiColor(0x888899)),
    });
