// Crypto portfolio — fintech palette: gold #F59E0B, purple #8B5CF6, dark #0F172A
FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN);
root.SetRequestedWidth(MATCH_PARENT);
root.SetRequestedHeight(MATCH_PARENT);
root.SetBackgroundColor(UiColor(0x0F172A));
root.SetPadding(Extents(64, 64, 56, 56));

// ---- header ----
FlexLayout header = FlexLayout::New();
header.SetDirection(FlexDirection::ROW);
header.SetJustifyContent(FlexJustify::SPACE_BETWEEN);
header.SetAlignItems(FlexAlign::CENTER);
header.SetRequestedWidth(MATCH_PARENT);
header.SetMargin(Extents(0, 0, 0, 36));
FlexLayout hl = FlexLayout::New();
hl.SetDirection(FlexDirection::COLUMN);
Label t1 = Label::New("Total Portfolio Value"); t1.SetFontSize(28); t1.SetTextColor(UiColor(0x94A3B8));
Label t2 = Label::New("$48,250.00"); t2.SetFontSize(76); t2.SetTextColor(UiColor(0xF8FAFC));
Label t3 = Label::New("+ $1,240.50   (+12.4%)"); t3.SetFontSize(30); t3.SetTextColor(UiColor(0x22C55E));
hl.AddChildren({ t1, t2, t3 });
FlexLayout cta = FlexLayout::New();
cta.SetJustifyContent(FlexJustify::CENTER); cta.SetAlignItems(FlexAlign::CENTER);
cta.SetBackgroundColor(UiColor(0xF59E0B)); cta.SetCornerRadius(18.0f);
cta.SetPadding(Extents(40, 40, 24, 24));
Label ctal = Label::New("Buy / Sell"); ctal.SetFontSize(32); ctal.SetTextColor(UiColor(0x0F172A));
cta.AddChildren({ ctal });
header.AddChildren({ hl, cta });

// ---- chart card (bar chart) ----
FlexLayout chart = FlexLayout::New();
chart.SetDirection(FlexDirection::COLUMN);
chart.SetBackgroundColor(UiColor(0x1E293B)); chart.SetCornerRadius(24.0f);
chart.SetPadding(Extents(40, 40, 32, 36));
chart.SetRequestedWidth(MATCH_PARENT);
chart.SetMargin(Extents(0, 0, 0, 28));
Label cl = Label::New("7-Day Performance"); cl.SetFontSize(26); cl.SetTextColor(UiColor(0x94A3B8));
cl.SetMargin(Extents(0, 0, 0, 26));
FlexLayout bars = FlexLayout::New();
bars.SetDirection(FlexDirection::ROW);
bars.SetAlignItems(FlexAlign::FLEX_END);
bars.SetJustifyContent(FlexJustify::SPACE_BETWEEN);
bars.SetRequestedWidth(MATCH_PARENT);
bars.SetRequestedHeight(170.0f);
View g1 = View::New(); g1.SetBackgroundColor(UiColor(0x334155)); g1.SetCornerRadius(8.0f); g1.SetRequestedWidth(70.0f); g1.SetRequestedHeight(70.0f);
View g2 = View::New(); g2.SetBackgroundColor(UiColor(0x334155)); g2.SetCornerRadius(8.0f); g2.SetRequestedWidth(70.0f); g2.SetRequestedHeight(95.0f);
View g3 = View::New(); g3.SetBackgroundColor(UiColor(0xF59E0B)); g3.SetCornerRadius(8.0f); g3.SetRequestedWidth(70.0f); g3.SetRequestedHeight(80.0f);
View g4 = View::New(); g4.SetBackgroundColor(UiColor(0xF59E0B)); g4.SetCornerRadius(8.0f); g4.SetRequestedWidth(70.0f); g4.SetRequestedHeight(120.0f);
View g5 = View::New(); g5.SetBackgroundColor(UiColor(0x8B5CF6)); g5.SetCornerRadius(8.0f); g5.SetRequestedWidth(70.0f); g5.SetRequestedHeight(105.0f);
View g6 = View::New(); g6.SetBackgroundColor(UiColor(0xF59E0B)); g6.SetCornerRadius(8.0f); g6.SetRequestedWidth(70.0f); g6.SetRequestedHeight(150.0f);
View g7 = View::New(); g7.SetBackgroundColor(UiColor(0x8B5CF6)); g7.SetCornerRadius(8.0f); g7.SetRequestedWidth(70.0f); g7.SetRequestedHeight(135.0f);
View g8 = View::New(); g8.SetBackgroundColor(UiColor(0xF59E0B)); g8.SetCornerRadius(8.0f); g8.SetRequestedWidth(70.0f); g8.SetRequestedHeight(170.0f);
bars.AddChildren({ g1, g2, g3, g4, g5, g6, g7, g8 });
chart.AddChildren({ cl, bars });

// ---- holdings (3 coin cards) ----
FlexLayout coins = FlexLayout::New();
coins.SetDirection(FlexDirection::ROW);
coins.SetJustifyContent(FlexJustify::SPACE_BETWEEN);
coins.SetRequestedWidth(MATCH_PARENT);
FlexLayout c1 = FlexLayout::New();
c1.SetDirection(FlexDirection::COLUMN); c1.SetBackgroundColor(UiColor(0x1E293B)); c1.SetCornerRadius(20.0f);
c1.SetPadding(Extents(32, 32, 28, 28)); c1.SetRequestedWidth(360.0f); c1.SetMargin(Extents(0, 14, 0, 0));
Label c1n = Label::New("Bitcoin"); c1n.SetFontSize(30); c1n.SetTextColor(UiColor(0xF8FAFC));
Label c1p = Label::New("$27,400"); c1p.SetFontSize(40); c1p.SetTextColor(UiColor(0xF59E0B));
Label c1c = Label::New("+2.3%"); c1c.SetFontSize(26); c1c.SetTextColor(UiColor(0x22C55E));
c1.AddChildren({ c1n, c1p, c1c });
FlexLayout c2 = FlexLayout::New();
c2.SetDirection(FlexDirection::COLUMN); c2.SetBackgroundColor(UiColor(0x1E293B)); c2.SetCornerRadius(20.0f);
c2.SetPadding(Extents(32, 32, 28, 28)); c2.SetRequestedWidth(360.0f); c2.SetMargin(Extents(14, 14, 0, 0));
Label c2n = Label::New("Ethereum"); c2n.SetFontSize(30); c2n.SetTextColor(UiColor(0xF8FAFC));
Label c2p = Label::New("$1,685"); c2p.SetFontSize(40); c2p.SetTextColor(UiColor(0x8B5CF6));
Label c2c = Label::New("-1.1%"); c2c.SetFontSize(26); c2c.SetTextColor(UiColor(0xEF4444));
c2.AddChildren({ c2n, c2p, c2c });
FlexLayout c3 = FlexLayout::New();
c3.SetDirection(FlexDirection::COLUMN); c3.SetBackgroundColor(UiColor(0x1E293B)); c3.SetCornerRadius(20.0f);
c3.SetPadding(Extents(32, 32, 28, 28)); c3.SetRequestedWidth(360.0f); c3.SetMargin(Extents(14, 0, 0, 0));
Label c3n = Label::New("Solana"); c3n.SetFontSize(30); c3n.SetTextColor(UiColor(0xF8FAFC));
Label c3p = Label::New("$98.20"); c3p.SetFontSize(40); c3p.SetTextColor(UiColor(0x22D3EE));
Label c3c = Label::New("+5.7%"); c3c.SetFontSize(26); c3c.SetTextColor(UiColor(0x22C55E));
c3.AddChildren({ c3n, c3p, c3c });
coins.AddChildren({ c1, c2, c3 });

root.AddChildren({ header, chart, coins });
return root;
