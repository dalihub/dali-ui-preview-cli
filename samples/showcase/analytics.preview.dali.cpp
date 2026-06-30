// Light SaaS analytics — slate/indigo, white cards on light bg
FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN);
root.SetRequestedWidth(MATCH_PARENT); root.SetRequestedHeight(MATCH_PARENT);
root.SetBackgroundColor(UiColor(0xEEF2F7));
root.SetPadding(Extents(64, 64, 56, 56));

FlexLayout head = FlexLayout::New(); head.SetDirection(FlexDirection::ROW);
head.SetJustifyContent(FlexJustify::SPACE_BETWEEN); head.SetAlignItems(FlexAlign::CENTER);
head.SetRequestedWidth(MATCH_PARENT); head.SetMargin(Extents(0,0,0,36));
FlexLayout hc = FlexLayout::New(); hc.SetDirection(FlexDirection::COLUMN);
Label h0 = Label::New("SALES OVERVIEW"); h0.SetFontSize(24); h0.SetTextColor(UiColor(0x6366F1));
Label h1 = Label::New("Good afternoon, Sam"); h1.SetFontSize(48); h1.SetTextColor(UiColor(0x0F172A));
hc.AddChildren({ h0, h1 });
FlexLayout pill = FlexLayout::New(); pill.SetJustifyContent(FlexJustify::CENTER); pill.SetAlignItems(FlexAlign::CENTER);
pill.SetBackgroundColor(UiColor(0xFFFFFF)); pill.SetCornerRadius(14.0f); pill.SetPadding(Extents(32,32,20,20));
Label pl = Label::New("This Month  ▾"); pl.SetFontSize(28); pl.SetTextColor(UiColor(0x334155));
pill.AddChildren({ pl });
head.AddChildren({ hc, pill });

// KPI row
FlexLayout kpis = FlexLayout::New(); kpis.SetDirection(FlexDirection::ROW);
kpis.SetJustifyContent(FlexJustify::SPACE_BETWEEN); kpis.SetRequestedWidth(MATCH_PARENT); kpis.SetMargin(Extents(0,0,0,28));
FlexLayout k1 = FlexLayout::New(); k1.SetDirection(FlexDirection::COLUMN); k1.SetBackgroundColor(UiColor(0xFFFFFF));
k1.SetCornerRadius(20.0f); k1.SetPadding(Extents(36,36,30,30)); k1.SetRequestedWidth(360.0f); k1.SetMargin(Extents(0,12,0,0));
Label k1a=Label::New("REVENUE"); k1a.SetFontSize(23); k1a.SetTextColor(UiColor(0x64748B));
Label k1b=Label::New("$84,250"); k1b.SetFontSize(54); k1b.SetTextColor(UiColor(0x0F172A));
Label k1c=Label::New("+18.2%  vs last month"); k1c.SetFontSize(23); k1c.SetTextColor(UiColor(0x16A34A));
k1.AddChildren({ k1a, k1b, k1c });
FlexLayout k2 = FlexLayout::New(); k2.SetDirection(FlexDirection::COLUMN); k2.SetBackgroundColor(UiColor(0xFFFFFF));
k2.SetCornerRadius(20.0f); k2.SetPadding(Extents(36,36,30,30)); k2.SetRequestedWidth(360.0f); k2.SetMargin(Extents(12,12,0,0));
Label k2a=Label::New("ORDERS"); k2a.SetFontSize(23); k2a.SetTextColor(UiColor(0x64748B));
Label k2b=Label::New("1,284"); k2b.SetFontSize(54); k2b.SetTextColor(UiColor(0x0F172A));
Label k2c=Label::New("+6.4%  vs last month"); k2c.SetFontSize(23); k2c.SetTextColor(UiColor(0x16A34A));
k2.AddChildren({ k2a, k2b, k2c });
FlexLayout k3 = FlexLayout::New(); k3.SetDirection(FlexDirection::COLUMN); k3.SetBackgroundColor(UiColor(0xFFFFFF));
k3.SetCornerRadius(20.0f); k3.SetPadding(Extents(36,36,30,30)); k3.SetRequestedWidth(360.0f); k3.SetMargin(Extents(12,0,0,0));
Label k3a=Label::New("CONVERSION"); k3a.SetFontSize(23); k3a.SetTextColor(UiColor(0x64748B));
Label k3b=Label::New("3.8%"); k3b.SetFontSize(54); k3b.SetTextColor(UiColor(0x0F172A));
Label k3c=Label::New("-1.1%  vs last month"); k3c.SetFontSize(23); k3c.SetTextColor(UiColor(0xDC2626));
k3.AddChildren({ k3a, k3b, k3c });
kpis.AddChildren({ k1, k2, k3 });

// chart card
FlexLayout card = FlexLayout::New(); card.SetDirection(FlexDirection::COLUMN); card.SetBackgroundColor(UiColor(0xFFFFFF));
card.SetCornerRadius(24.0f); card.SetPadding(Extents(44,44,36,38)); card.SetRequestedWidth(MATCH_PARENT);
Label cl = Label::New("Revenue — last 7 months"); cl.SetFontSize(28); cl.SetTextColor(UiColor(0x0F172A)); cl.SetMargin(Extents(0,0,0,28));
FlexLayout bars = FlexLayout::New(); bars.SetDirection(FlexDirection::ROW); bars.SetAlignItems(FlexAlign::FLEX_END);
bars.SetJustifyContent(FlexJustify::SPACE_BETWEEN); bars.SetRequestedWidth(MATCH_PARENT); bars.SetRequestedHeight(150.0f);
View b1=View::New(); b1.SetBackgroundColor(UiColor(0xC7D2FE)); b1.SetCornerRadius(8.0f); b1.SetRequestedWidth(110.0f); b1.SetRequestedHeight(70.0f);
View b2=View::New(); b2.SetBackgroundColor(UiColor(0xC7D2FE)); b2.SetCornerRadius(8.0f); b2.SetRequestedWidth(110.0f); b2.SetRequestedHeight(95.0f);
View b3=View::New(); b3.SetBackgroundColor(UiColor(0xC7D2FE)); b3.SetCornerRadius(8.0f); b3.SetRequestedWidth(110.0f); b3.SetRequestedHeight(85.0f);
View b4=View::New(); b4.SetBackgroundColor(UiColor(0xA5B4FC)); b4.SetCornerRadius(8.0f); b4.SetRequestedWidth(110.0f); b4.SetRequestedHeight(118.0f);
View b5=View::New(); b5.SetBackgroundColor(UiColor(0xA5B4FC)); b5.SetCornerRadius(8.0f); b5.SetRequestedWidth(110.0f); b5.SetRequestedHeight(105.0f);
View b6=View::New(); b6.SetBackgroundColor(UiColor(0x6366F1)); b6.SetCornerRadius(8.0f); b6.SetRequestedWidth(110.0f); b6.SetRequestedHeight(150.0f);
View b7=View::New(); b7.SetBackgroundColor(UiColor(0x818CF8)); b7.SetCornerRadius(8.0f); b7.SetRequestedWidth(110.0f); b7.SetRequestedHeight(132.0f);
bars.AddChildren({ b1,b2,b3,b4,b5,b6,b7 });
card.AddChildren({ cl, bars });

root.AddChildren({ head, kpis, card });
return root;
