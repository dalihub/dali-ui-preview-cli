FlexLayout root = FlexLayout::New();
root.SetDirection(FlexDirection::COLUMN); root.SetAlignItems(FlexAlign::CENTER);
root.SetJustifyContent(FlexJustify::CENTER);
root.SetRequestedWidth(MATCH_PARENT); root.SetRequestedHeight(MATCH_PARENT);
root.SetBackgroundColor(UiColor(0x0F0F23)); root.SetPadding(Extents(80, 80, 60, 60));

// equalizer bars (vibrant)
FlexLayout eq = FlexLayout::New(); eq.SetDirection(FlexDirection::ROW);
eq.SetAlignItems(FlexAlign::FLEX_END); eq.SetJustifyContent(FlexJustify::CENTER);
eq.SetRequestedWidth(MATCH_PARENT); eq.SetRequestedHeight(220.0f); eq.SetMargin(Extents(0,0,0,44));
View e1=View::New(); e1.SetBackgroundColor(UiColor(0x6366F1)); e1.SetCornerRadius(7.0f); e1.SetRequestedWidth(26.0f); e1.SetRequestedHeight(80.0f); e1.SetMargin(Extents(7,7,0,0));
View e2=View::New(); e2.SetBackgroundColor(UiColor(0x818CF8)); e2.SetCornerRadius(7.0f); e2.SetRequestedWidth(26.0f); e2.SetRequestedHeight(150.0f); e2.SetMargin(Extents(7,7,0,0));
View e3=View::New(); e3.SetBackgroundColor(UiColor(0xA855F7)); e3.SetCornerRadius(7.0f); e3.SetRequestedWidth(26.0f); e3.SetRequestedHeight(110.0f); e3.SetMargin(Extents(7,7,0,0));
View e4=View::New(); e4.SetBackgroundColor(UiColor(0xEC4899)); e4.SetCornerRadius(7.0f); e4.SetRequestedWidth(26.0f); e4.SetRequestedHeight(200.0f); e4.SetMargin(Extents(7,7,0,0));
View e5=View::New(); e5.SetBackgroundColor(UiColor(0xEC4899)); e5.SetCornerRadius(7.0f); e5.SetRequestedWidth(26.0f); e5.SetRequestedHeight(170.0f); e5.SetMargin(Extents(7,7,0,0));
View e6=View::New(); e6.SetBackgroundColor(UiColor(0xA855F7)); e6.SetCornerRadius(7.0f); e6.SetRequestedWidth(26.0f); e6.SetRequestedHeight(130.0f); e6.SetMargin(Extents(7,7,0,0));
View e7=View::New(); e7.SetBackgroundColor(UiColor(0x818CF8)); e7.SetCornerRadius(7.0f); e7.SetRequestedWidth(26.0f); e7.SetRequestedHeight(190.0f); e7.SetMargin(Extents(7,7,0,0));
View e8=View::New(); e8.SetBackgroundColor(UiColor(0x6366F1)); e8.SetCornerRadius(7.0f); e8.SetRequestedWidth(26.0f); e8.SetRequestedHeight(95.0f); e8.SetMargin(Extents(7,7,0,0));
View e9=View::New(); e9.SetBackgroundColor(UiColor(0xA855F7)); e9.SetCornerRadius(7.0f); e9.SetRequestedWidth(26.0f); e9.SetRequestedHeight(155.0f); e9.SetMargin(Extents(7,7,0,0));
eq.AddChildren({ e1,e2,e3,e4,e5,e6,e7,e8,e9 });

Label now = Label::New("NOW PLAYING"); now.SetFontSize(24); now.SetTextColor(UiColor(0x818CF8)); now.SetMargin(Extents(0,0,0,12));
Label song = Label::New("Midnight City"); song.SetFontSize(72); song.SetTextColor(UiColor(0xF8FAFC));
Label artist = Label::New("M83  •  Hurry Up, We're Dreaming"); artist.SetFontSize(30); artist.SetTextColor(UiColor(0x9CA3AF)); artist.SetMargin(Extents(0,0,8,0));

View bar = View::New(); bar.SetBackgroundColor(UiColor(0x27273B)); bar.SetCornerRadius(6.0f);
bar.SetRequestedWidth(760.0f); bar.SetRequestedHeight(12.0f); bar.SetMargin(Extents(0,0,36,0));
View prog = View::New(); prog.SetBackgroundColor(UiColor(0xEC4899)); prog.SetCornerRadius(6.0f);
prog.SetRequestedWidth(470.0f); prog.SetRequestedHeight(12.0f);
bar.AddChildren({ prog });

FlexLayout ctr = FlexLayout::New(); ctr.SetDirection(FlexDirection::ROW); ctr.SetAlignItems(FlexAlign::CENTER);
View pv = View::New(); pv.SetBackgroundColor(UiColor(0x27273B)); pv.SetCornerRadius(36.0f); pv.SetRequestedWidth(72.0f); pv.SetRequestedHeight(72.0f); pv.SetMargin(Extents(0,28,0,0));
FlexLayout play = FlexLayout::New(); play.SetJustifyContent(FlexJustify::CENTER); play.SetAlignItems(FlexAlign::CENTER);
play.SetBackgroundColor(UiColor(0xEC4899)); play.SetCornerRadius(56.0f); play.SetRequestedWidth(112.0f); play.SetRequestedHeight(112.0f); play.SetMargin(Extents(28,28,0,0));
Label pl = Label::New("II"); pl.SetFontSize(44); pl.SetTextColor(UiColor(0xFFFFFF));
play.AddChildren({ pl });
View nx = View::New(); nx.SetBackgroundColor(UiColor(0x27273B)); nx.SetCornerRadius(36.0f); nx.SetRequestedWidth(72.0f); nx.SetRequestedHeight(72.0f); nx.SetMargin(Extents(28,0,0,0));
ctr.AddChildren({ pv, play, nx });

root.AddChildren({ eq, now, song, artist, bar, ctr });
return root;
