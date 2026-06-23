// hello-dali.preview.dali.cpp
//
// Welcome to DALi Preview! This is your first preview file.
//
// • Save (Ctrl+S) — the preview re-renders automatically
// • Edit the code below and watch the preview update
// • This file uses the `.preview.dali.cpp` naming convention so the
//   extension recognises it as a preview source
//
// The preview canvas can be resized in the webview panel — the layout
// recomputes for the new dimensions.
//
// dali-ui uses a non-fluent builder API: declare a named local, call the
// setters as separate statements, add children with AddChildren, then
// return the root.

FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN);
root.SetAlignItems(FlexAlign::CENTER);
root.SetJustifyContent(FlexJustify::CENTER);
root.SetRequestedWidth(MATCH_PARENT);
root.SetRequestedHeight(MATCH_PARENT);
root.SetBackgroundColor(UiColor(0x1e1e2e));

Label title = Label::New("Hello, Dali!");
title.SetFontSize(48);
title.SetTextColor(UiColor(0xFFFFFF));

Label subtitle = Label::New("Edit this file to see the preview update");
subtitle.SetFontSize(18);
subtitle.SetTextColor(UiColor(0x888899));

root.AddChildren({
    title,
    subtitle,
});
return root;
