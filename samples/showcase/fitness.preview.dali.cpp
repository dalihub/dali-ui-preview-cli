FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN);
root.SetRequestedWidth(MATCH_PARENT);
root.SetRequestedHeight(MATCH_PARENT);
root.SetBackgroundColor(UiColor(0x111827));
root.SetPadding(Extents(64, 64, 56, 56));

FlexLayout head = FlexLayout::New();
head.SetDirection(FlexDirection::ROW); head.SetJustifyContent(FlexJustify::SPACE_BETWEEN);
head.SetAlignItems(FlexAlign::FLEX_END); head.SetRequestedWidth(MATCH_PARENT); head.SetMargin(Extents(0,0,0,36));
FlexLayout hc = FlexLayout::New(); hc.SetDirection(FlexDirection::COLUMN);
Label h1 = Label::New("ACTIVITY"); h1.SetFontSize(26); h1.SetTextColor(UiColor(0xF97316));
Label h2 = Label::New("Good morning, Alex"); h2.SetFontSize(48); h2.SetTextColor(UiColor(0xF8FAFC));
hc.AddChildren({ h1, h2 });
Label hd = Label::New("Tue, Jun 30"); hd.SetFontSize(28); hd.SetTextColor(UiColor(0x9CA3AF));
head.AddChildren({ hc, hd });

// hero: big steps + progress
FlexLayout hero = FlexLayout::New();
hero.SetDirection(FlexDirection::COLUMN); hero.SetBackgroundColor(UiColor(0xF97316));
hero.SetCornerRadius(28.0f); hero.SetPadding(Extents(48, 48, 40, 44));
hero.SetRequestedWidth(MATCH_PARENT); hero.SetMargin(Extents(0,0,0,28));
Label hs1 = Label::New("STEPS TODAY"); hs1.SetFontSize(26); hs1.SetTextColor(UiColor(0x7C2D12));
FlexLayout hr = FlexLayout::New(); hr.SetDirection(FlexDirection::ROW); hr.SetAlignItems(FlexAlign::FLEX_END);
Label hs2 = Label::New("8,412"); hs2.SetFontSize(96); hs2.SetTextColor(UiColor(0xFFFFFF));
Label hs3 = Label::New("  / 10,000  •  84%"); hs3.SetFontSize(34); hs3.SetTextColor(UiColor(0xFFEDD5));
hr.AddChildren({ hs2, hs3 });
View track = View::New(); track.SetBackgroundColor(UiColor(0xC2410C)); track.SetCornerRadius(10.0f);
track.SetRequestedWidth(MATCH_PARENT); track.SetRequestedHeight(20.0f); track.SetMargin(Extents(0,0,20,0));
View fill = View::New(); fill.SetBackgroundColor(UiColor(0xFFFFFF)); fill.SetCornerRadius(10.0f);
fill.SetRequestedWidth(900.0f); fill.SetRequestedHeight(20.0f);
track.AddChildren({ fill });
hero.AddChildren({ hs1, hr, track });

// 3 stat blocks
FlexLayout row = FlexLayout::New(); row.SetDirection(FlexDirection::ROW);
row.SetJustifyContent(FlexJustify::SPACE_BETWEEN); row.SetRequestedWidth(MATCH_PARENT);
View s1 = View::New(); s1.SetBackgroundColor(UiColor(0x1F2937)); s1.SetCornerRadius(20.0f);
s1.SetRequestedWidth(360.0f); s1.SetRequestedHeight(190.0f); s1.SetMargin(Extents(0,14,0,0));
FlexLayout s1c = FlexLayout::New(); s1c.SetDirection(FlexDirection::COLUMN); s1c.SetPadding(Extents(34,34,30,30));
Label s1a = Label::New("CALORIES"); s1a.SetFontSize(24); s1a.SetTextColor(UiColor(0x9CA3AF));
Label s1b = Label::New("540"); s1b.SetFontSize(56); s1b.SetTextColor(UiColor(0xF97316));
Label s1d = Label::New("kcal burned"); s1d.SetFontSize(24); s1d.SetTextColor(UiColor(0x6B7280));
s1c.AddChildren({ s1a, s1b, s1d }); s1.AddChildren({ s1c });
View s2 = View::New(); s2.SetBackgroundColor(UiColor(0x1F2937)); s2.SetCornerRadius(20.0f);
s2.SetRequestedWidth(360.0f); s2.SetRequestedHeight(190.0f); s2.SetMargin(Extents(14,14,0,0));
FlexLayout s2c = FlexLayout::New(); s2c.SetDirection(FlexDirection::COLUMN); s2c.SetPadding(Extents(34,34,30,30));
Label s2a = Label::New("DISTANCE"); s2a.SetFontSize(24); s2a.SetTextColor(UiColor(0x9CA3AF));
Label s2b = Label::New("5.2"); s2b.SetFontSize(56); s2b.SetTextColor(UiColor(0x38BDF8));
Label s2d = Label::New("km walked"); s2d.SetFontSize(24); s2d.SetTextColor(UiColor(0x6B7280));
s2c.AddChildren({ s2a, s2b, s2d }); s2.AddChildren({ s2c });
View s3 = View::New(); s3.SetBackgroundColor(UiColor(0x1F2937)); s3.SetCornerRadius(20.0f);
s3.SetRequestedWidth(360.0f); s3.SetRequestedHeight(190.0f); s3.SetMargin(Extents(14,0,0,0));
FlexLayout s3c = FlexLayout::New(); s3c.SetDirection(FlexDirection::COLUMN); s3c.SetPadding(Extents(34,34,30,30));
Label s3a = Label::New("ACTIVE"); s3a.SetFontSize(24); s3a.SetTextColor(UiColor(0x9CA3AF));
Label s3b = Label::New("47"); s3b.SetFontSize(56); s3b.SetTextColor(UiColor(0x34D399));
Label s3d = Label::New("minutes"); s3d.SetFontSize(24); s3d.SetTextColor(UiColor(0x6B7280));
s3c.AddChildren({ s3a, s3b, s3d }); s3.AddChildren({ s3c });
row.AddChildren({ s1, s2, s3 });

root.AddChildren({ head, hero, row });
return root;
