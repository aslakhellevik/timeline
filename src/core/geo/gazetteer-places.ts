/**
 * The bundled gazetteer's raw data (docs/design.md §11.4).
 *
 * One line per place, `name|lat|lon|precisionKm`, packed as text rather than as
 * JSON objects because the field names would be four times the size of the data
 * and every one of them is already known. Parsed once, lazily, by `gazetteer.ts`.
 *
 * Three sources, in the order they are listed — first spelling of a name wins,
 * so a historical site always beats a modern city of the same name:
 *
 *  - ~65 **historical places** written by hand. This is the half no modern
 *    gazetteer has and a history timeline needs most: Constantinople is not
 *    Istanbul, and an event at Carthage did not happen in a suburb of Tunis.
 *    The radius is the size of the place as it was, not a default.
 *  - Natural Earth `ne_110m_populated_places` (243 cities), at 25 km each — a
 *    city is a place a day's walk across, and pretending otherwise would make
 *    the halo (D43) lie in the one direction it exists to prevent.
 *  - Natural Earth `ne_110m_admin_0_countries` (177), at the label point, with
 *    the radius derived from the country's own spherical area: `√(area/π)`.
 *    Russia comes out at 2321 km and Monaco at the 10 km floor, which is the
 *    honest reading of "somewhere in Russia".
 *
 * Both Natural Earth layers are public domain; see `gazetteer-places.LICENSE`.
 * Generated offline and committed, for the same reason as the coastlines: no
 * network at capture time (D25), and the data cannot change under the app.
 */

export const GAZETTEER_PLACES = `
Constantinople|41.01|28.98|15
Byzantium|41.01|28.98|10
Carthage|36.85|10.32|10
Babylon|32.54|44.42|10
Nineveh|36.36|43.15|8
Ur|30.96|46.1|5
Uruk|31.32|45.64|5
Persepolis|29.94|52.89|5
Susa|32.19|48.26|5
Ctesiphon|33.09|44.58|8
Alexandria|31.2|29.92|15
Memphis|29.85|31.25|8
Thebes|25.72|32.61|10
Troy|39.96|26.24|5
Sparta|37.07|22.43|8
Mycenae|37.73|22.76|5
Knossos|35.3|25.16|5
Delphi|38.48|22.5|5
Ephesus|37.94|27.34|5
Pergamon|39.13|27.18|5
Antioch|36.2|36.16|10
Palmyra|34.55|38.27|8
Petra|30.33|35.44|8
Jericho|31.87|35.44|5
Tyre|33.27|35.2|5
Sidon|33.56|35.37|5
Aachen|50.78|6.08|10
Ravenna|44.42|12.2|10
Kyiv|50.45|30.52|20
Kiev|50.45|30.52|20
Novgorod|58.52|31.28|10
Cordoba|37.89|-4.78|12
Granada|37.18|-3.6|10
Toledo|39.86|-4.03|10
Timbuktu|16.77|-3.01|12
Great Zimbabwe|-20.27|30.93|10
Meroe|16.94|33.75|8
Aksum|14.13|38.72|8
Tenochtitlan|19.43|-99.13|12
Teotihuacan|19.69|-98.84|8
Cuzco|-13.53|-71.97|12
Machu Picchu|-13.16|-72.55|3
Chichen Itza|20.68|-88.57|5
Tikal|17.22|-89.62|5
Angkor|13.41|103.87|20
Chang'an|34.27|108.95|15
Kaifeng|34.8|114.31|12
Nara|34.69|135.8|10
Kamakura|35.32|139.55|8
Edo|35.68|139.76|20
Pataliputra|25.61|85.14|10
Taxila|33.74|72.79|8
Mohenjo-daro|27.33|68.14|5
Samarkand|39.65|66.96|15
Bukhara|39.77|64.42|12
Nalanda|25.14|85.44|5
Vijayanagara|15.34|76.46|10
Hattusa|40.02|34.62|5
Olympia|37.64|21.63|5
Pompeii|40.75|14.49|4
Cahokia|38.66|-90.06|8
Vatican City|41.9|12.45|25
San Marino|43.94|12.44|25
Vaduz|47.13|9.52|25
Lobamba|-26.47|31.2|25
Luxembourg|49.61|6.13|25
Palikir|6.92|158.15|25
Majuro|7.1|171.38|25
Funafuti|-8.52|179.22|25
Melekeok|7.49|134.63|25
Bir Lehlou|26.12|-9.65|25
Monaco|43.74|7.41|25
Tarawa|1.34|173.02|25
Moroni|-11.7|43.24|25
Andorra|42.5|1.52|25
Port-of-Spain|10.65|-61.52|25
Kigali|-1.95|30.06|25
Mbabane|-26.32|31.13|25
Juba|4.83|31.58|25
The Hague|52.08|4.27|25
Ljubljana|46.06|14.51|25
Bratislava|48.15|17.12|25
Doha|25.29|51.53|25
Podgorica|42.47|19.27|25
Sri Jayawardenepura Kotte|6.9|79.95|25
Baguio|16.43|120.57|25
Dodoma|-6.18|35.75|25
Bern|46.92|7.47|25
Laayoune|27.15|-13.2|25
Pristina|42.67|21.17|25
Roseau|15.3|-61.39|25
Djibouti|11.6|43.15|25
Putrajaya|2.91|101.7|25
Kyoto|35.03|135.75|25
Banjul|13.45|-16.59|25
Skopje|42|21.43|25
Bridgetown|13.1|-59.62|25
Porto-Novo|6.48|2.62|25
Bujumbura|-3.38|29.36|25
Kingstown|13.15|-61.21|25
Castries|14|-61|25
Basseterre|17.3|-62.72|25
Port Louis|-20.17|57.5|25
Saint George's|12.05|-61.74|25
Manama|26.24|50.58|25
Saint John's|17.12|-61.85|25
Montevideo|-34.86|-56.17|25
Lomé|6.13|1.22|25
Tunis|36.8|10.18|25
Abu Dhabi|24.47|54.37|25
Ashgabat|37.95|58.38|25
Lusaka|-15.41|28.28|25
Harare|-17.82|31.04|25
Dili|-8.56|125.58|25
Port Vila|-17.73|168.32|25
Tegucigalpa|14.1|-87.22|25
Georgetown|6.8|-58.17|25
Reykjavík|64.15|-21.95|25
Port-au-Prince|18.54|-72.34|25
Kampala|0.32|32.58|25
Paramaribo|5.84|-55.17|25
Niamey|13.52|2.11|25
Dushanbe|38.56|68.77|25
Asunción|-25.29|-57.64|25
Managua|12.15|-86.27|25
Freetown|8.47|-13.24|25
Islamabad|33.7|73.16|25
Kathmandu|27.72|85.31|25
Bloemfontein|-29.12|26.23|25
Pretoria|-25.7|28.23|25
Port Moresby|-9.46|147.19|25
Honiara|-9.44|159.95|25
Panama City|8.97|-79.53|25
Rabat|34.03|-6.84|25
Chișinău|47.01|28.86|25
Maputo|-25.95|32.59|25
Mogadishu|2.07|45.36|25
Muscat|23.61|58.59|25
Colombo|6.93|79.86|25
Ulaanbaatar|47.92|106.91|25
Windhoek|-22.57|17.08|25
Abuja|9.09|7.53|25
Bissau|11.87|-15.6|25
Amman|31.95|35.93|25
Vilnius|54.68|25.32|25
Riga|56.95|24.1|25
Bishkek|42.88|74.58|25
Maseru|-29.32|27.48|25
Antananarivo|-18.91|47.51|25
Quito|-0.21|-78.5|25
San José|9.94|-84.09|25
San Salvador|13.71|-89.2|25
Kingston|17.98|-76.77|25
N'Djamena|12.12|15.05|25
Malabo|3.75|8.78|25
Asmara|15.33|38.93|25
Zagreb|45.8|16|25
Tallinn|59.43|24.73|25
Lilongwe|-13.98|33.78|25
Guatemala City|14.62|-90.53|25
Libreville|0.39|9.46|25
Suva|-18.13|178.44|25
Valparaíso|-33.05|-71.62|25
Nouakchott|18.09|-15.98|25
Bamako|12.65|-8|25
Beirut|33.87|35.51|25
Tbilisi|41.73|44.79|25
Nur-Sultan|51.18|71.43|25
Vientiane|17.97|102.6|25
Brazzaville|-4.26|15.28|25
Conakry|9.53|-13.68|25
Yamoussoukro|6.82|-5.28|25
Ottawa|45.42|-75.7|25
Belgrade|44.82|20.47|25
Bandar Seri Begawan|4.88|114.93|25
Sucre|-19.04|-65.26|25
Belmopan|17.25|-88.77|25
Bangui|4.37|18.56|25
Yaoundé|3.87|11.51|25
Tirana|41.33|19.82|25
Yerevan|40.18|44.51|25
Baku|40.4|49.86|25
Phnom Penh|11.55|104.91|25
La Paz|-16.5|-68.15|25
Cotonou|6.4|2.52|25
Sofia|42.69|23.31|25
Minsk|53.9|27.56|25
Thimphu|27.47|89.64|25
Gaborone|-24.65|25.91|25
Canberra|-35.28|149.13|25
Ouagadougou|12.37|-1.53|25
Sarajevo|43.85|18.38|25
Naypyidaw|19.77|96.12|25
Nuku'alofa|-21.14|-175.22|25
Hargeisa|9.56|44.07|25
Victoria|-4.62|55.45|25
São Tomé|0.33|6.73|25
Apia|-13.84|-171.74|25
Valletta|35.9|14.51|25
Malé|4.17|73.5|25
Jerusalem|31.78|35.21|25
Praia|14.92|-23.52|25
Nassau|25.08|-77.35|25
Nicosia|35.17|33.37|25
Wellington|-41.3|174.78|25
Hanoi|21.04|105.85|25
Ankara|39.93|32.86|25
Budapest|47.5|19.08|25
Sanaa|15.36|44.2|25
Bucharest|44.44|26.1|25
Damascus|33.5|36.3|25
Lisbon|38.72|-9.15|25
Khartoum|15.59|32.53|25
Oslo|59.92|10.75|25
Warsaw|52.25|21|25
Pyongyang|39.02|125.75|25
Dar es Salaam|-6.8|39.27|25
Dublin|53.34|-6.25|25
Monrovia|6.31|-10.8|25
Kuala Lumpur|3.17|101.7|25
Havana|23.13|-82.37|25
Prague|50.09|14.46|25
Kuwait City|29.37|47.98|25
Santo Domingo|18.47|-69.9|25
Accra|5.55|-0.22|25
Tripoli|32.89|13.18|25
Tel Aviv|32.08|34.77|25
Helsinki|60.18|24.93|25
København|55.68|12.56|25
Abidjan|5.32|-4.04|25
Brasília|-15.78|-47.92|25
Brussels|50.84|4.33|25
Dhaka|23.73|90.41|25
Luanda|-8.84|13.23|25
Algiers|36.77|3.05|25
Yangon|16.79|96.16|25
San Francisco|37.77|-122.42|25
Denver|39.74|-104.99|25
Houston|29.82|-95.34|25
Miami|25.79|-80.23|25
Atlanta|33.83|-84.4|25
Chicago|41.83|-87.75|25
Caracas|10.5|-66.92|25
Dubai|25.23|55.28|25
Tashkent|41.31|69.29|25
Madrid|40.4|-3.69|25
Geneva|46.21|6.14|25
Stockholm|59.35|18.1|25
Bangkok|13.75|100.51|25
Lima|-12.05|-77.05|25
Dakar|14.72|-17.48|25
Johannesburg|-26.17|28.03|25
Amsterdam|52.35|4.91|25
Casablanca|33.6|-7.62|25
Seoul|37.57|127|25
Manila|14.61|120.98|25
Monterrey|25.67|-100.33|25
Berlin|52.52|13.4|25
Ürümqi|43.81|87.57|25
Chengdu|30.67|104.07|25
Ōsaka|34.75|135.46|25
Kinshasa|-4.33|15.31|25
New Delhi|28.6|77.2|25
Bengaluru|12.97|77.56|25
Athens|37.99|23.73|25
Baghdad|33.34|44.39|25
Addis Ababa|9.04|38.7|25
Tehran|35.67|51.42|25
Vancouver|49.28|-123.12|25
Toronto|43.7|-79.42|25
Buenos Aires|-34.6|-58.4|25
Kabul|34.52|69.18|25
Vienna|48.2|16.36|25
Melbourne|-37.82|144.97|25
Taipei|25.04|121.57|25
Auckland|-36.85|174.76|25
Los Angeles|33.99|-118.18|25
Washington,  D.C.|38.9|-77.01|25
New York|40.75|-73.98|25
London|51.5|-0.12|25
Istanbul|41.11|29.01|25
Riyadh|24.64|46.77|25
Cape Town|-33.92|18.43|25
Moscow|55.75|37.61|25
Mexico City|19.44|-99.13|25
Lagos|6.45|3.39|25
Rome|41.9|12.48|25
Beijing|39.93|116.39|25
Nairobi|-1.28|36.81|25
Jakarta|-6.17|106.83|25
Bogota|4.6|-74.09|25
Cairo|30.05|31.25|25
Shanghai|31.22|121.43|25
Tokyo|35.69|139.75|25
Mumbai|19.02|72.86|25
Paris|48.87|2.33|25
Santiago|-33.45|-70.67|25
Kolkata|22.5|88.32|25
Rio de Janeiro|-22.92|-43.23|25
São Paulo|-23.56|-46.63|25
Sydney|-33.92|151.18|25
Singapore|1.29|103.85|25
Hong Kong|22.31|114.18|25
Fiji|-17.83|177.98|78
Tanzania|-6.05|34.96|546
W. Sahara|23.97|-12.63|176
Canada|60.32|-101.91|1783
United States of America|39.54|-97.48|1738
Kazakhstan|49.05|68.69|931
Uzbekistan|41.69|64.01|383
Papua New Guinea|-5.7|143.91|385
Indonesia|-0.95|101.89|763
Argentina|-33.5|-64.17|941
Chile|-38.15|-72.32|509
Dem. Rep. Congo|-1.86|23.46|862
Somalia|3.57|45.19|393
Kenya|0.55|37.91|435
Sudan|16.33|29.26|769
Chad|15.14|18.65|637
Haiti|19.26|-72.22|95
Dominican Rep.|19.1|-70.65|124
Russia|58.25|44.69|2321
Bahamas|26.4|-77.15|71
Falkland Is.|-51.61|-58.74|72
Norway|61.36|9.68|354
Greenland|74.32|-39.34|835
Fr. S. Antarctic Lands|-49.3|69.12|61
Timor-Leste|-8.8|125.85|69
South Africa|-29.71|23.67|623
Lesotho|-29.48|28.25|94
Mexico|23.92|-102.29|793
Uruguay|-32.96|-55.97|237
Brazil|-12.1|-49.56|1649
Bolivia|-16.67|-64.59|589
Peru|-12.98|-72.9|647
Colombia|3.37|-73.17|607
Panama|8.72|-80.35|155
Costa Rica|10.07|-84.08|131
Nicaragua|12.67|-85.07|203
Honduras|14.79|-86.89|191
El Salvador|13.69|-88.89|82
Guatemala|14.98|-90.5|187
Belize|17.2|-88.71|84
Venezuela|7.18|-64.6|539
Guyana|5.12|-58.94|259
Suriname|4.14|-55.91|215
France|46.7|2.55|453
Ecuador|-1.26|-78.19|283
Puerto Rico|18.23|-66.48|54
Jamaica|18.14|-77.32|63
Cuba|21.33|-77.98|191
Zimbabwe|-18.91|29.93|347
Botswana|-22.1|24.18|435
Namibia|-20.58|17.11|513
Senegal|15.14|-14.78|249
Mali|18.69|-2.04|628
Mauritania|19.59|-9.74|580
Benin|10.32|2.35|193
Niger|17.45|9.5|614
Nigeria|9.44|7.5|538
Cameroon|4.59|12.47|384
Togo|8.81|1.06|140
Ghana|7.72|-1.04|279
Côte d'Ivoire|7.49|-5.57|325
Guinea|10.62|-10.02|277
Guinea-Bissau|12.16|-14.52|108
Liberia|6.45|-9.46|177
Sierra Leone|8.62|-11.76|156
Burkina Faso|12.67|-1.36|295
Central African Rep.|6.99|20.91|446
Congo|0.14|15.9|330
Gabon|-0.44|11.84|294
Eq. Guinea|2.33|8.99|93
Zambia|-14.66|26.4|490
Malawi|-13.39|33.61|188
Mozambique|-13.94|37.84|509
eSwatini|-26.53|31.47|76
Angola|-12.18|17.98|631
Burundi|-3.33|29.92|92
Israel|30.91|34.85|86
Lebanon|34.13|35.99|57
Madagascar|-18.63|46.7|434
Palestine|32.05|35.29|40
Gambia|13.64|-15|67
Tunisia|33.69|9.01|223
Algeria|27.4|2.81|860
Jordan|30.81|36.38|168
United Arab Emirates|23.47|54.55|160
Qatar|25.24|51.14|60
Kuwait|29.41|47.31|73
Iraq|33.09|43.26|373
Oman|22.12|57.34|314
Vanuatu|-15.37|166.91|49
Cambodia|12.65|104.5|241
Thailand|15.46|101.07|404
Laos|19.43|102.53|270
Myanmar|21.57|95.8|466
Vietnam|21.72|105.39|328
North Korea|39.89|126.44|200
South Korea|36.38|128.13|178
Mongolia|46|104.15|700
India|22.69|79.36|1001
Bangladesh|24.21|89.68|207
Bhutan|27.54|90.04|112
Nepal|28.3|83.64|219
Pakistan|29.33|68.55|528
Afghanistan|34.16|66.5|456
Tajikistan|38.2|72.59|210
Kyrgyzstan|41.67|74.53|250
Turkmenistan|39.86|58.68|391
Iran|32.17|54.93|718
Syria|35.01|38.28|243
Armenia|40.46|44.8|95
Sweden|65.86|19.02|378
Belarus|53.82|28.42|257
Ukraine|49.72|32.14|426
Poland|51.99|19.49|314
Austria|47.52|14.13|164
Hungary|47.09|19.45|171
Moldova|47.43|28.49|101
Romania|45.73|24.97|275
Lithuania|55.1|24.09|142
Latvia|57.07|25.46|142
Estonia|58.72|25.87|119
Germany|50.96|9.68|337
Bulgaria|42.51|25.16|187
Greece|39.49|21.73|205
Turkey|39.35|34.51|504
Albania|40.65|20.11|97
Croatia|45.81|16.37|135
Switzerland|46.72|7.46|121
Belgium|50.79|4.8|98
Netherlands|52.42|5.61|113
Portugal|39.61|-8.27|172
Spain|40.09|-3.46|400
Ireland|53.08|-7.8|136
New Caledonia|-21.06|165.08|86
Solomon Is.|-8.03|159.17|89
New Zealand|-39.76|172.79|297
Australia|-24.13|134.05|1566
Sri Lanka|7.58|80.7|145
China|32.5|106.34|1730
Taiwan|23.65|120.87|105
Italy|44.73|11.08|316
Denmark|55.97|9.02|116
United Kingdom|54.4|-2.12|281
Iceland|64.78|-18.67|185
Azerbaijan|40.4|47.21|170
Georgia|41.87|43.74|148
Philippines|11.2|122.47|306
Malaysia|2.53|113.84|329
Brunei|4.45|114.55|58
Slovenia|46.06|14.92|78
Finland|63.25|27.28|329
Slovakia|48.73|19.05|122
Czechia|49.88|15.38|161
Eritrea|15.79|38.29|195
Japan|36.14|138.44|359
Paraguay|-21.67|-60.15|358
Yemen|15.33|45.87|382
Saudi Arabia|23.81|44.7|783
Antarctica|-79.84|35.89|1974
N. Cyprus|35.22|33.69|35
Cyprus|34.91|33.08|45
Morocco|31.65|-7.19|434
Egypt|26.19|29.45|564
Libya|26.64|18.01|722
Ethiopia|8.03|39.09|602
Somaliland|9.44|46.73|231
Uganda|1.97|32.95|280
Rwanda|-1.9|30.1|86
Bosnia and Herz.|44.09|18.07|127
North Macedonia|41.56|21.56|89
Serbia|44.19|20.79|156
Montenegro|42.8|19.14|65
Kosovo|42.59|20.86|60
Trinidad and Tobago|11|-60.92|50
S. Sudan|7.23|30.39|447`;
