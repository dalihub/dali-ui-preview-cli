// hello-dali.preview.dali.cpp
//
// Welcome to DALi Preview! This is your first preview file.
//
// dali-ui builder style (current API): declare a named local, call setters as
// separate statements (setters return void — no method chaining), add children
// with AddChildren({...}), then return the root.
//
// • Save (Ctrl+S) — the preview re-renders automatically
// • Edit the statements below and watch the preview update
// • The `.preview.dali.cpp` name marks this file as a preview source

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

root.AddChildren({ title, subtitle });
return root;
