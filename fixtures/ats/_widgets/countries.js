/*
 * Country data shared by the widget torture pages (react-select country list,
 * intl-tel-input dropdown, react-phone-number-input native select).
 * [name, iso2, dialCode, nationalPlaceholder?]. Local fixture data only.
 */
(function () {
  'use strict';
  var C = [
    ['Afghanistan','af','93'],['Albania','al','355'],['Algeria','dz','213'],['American Samoa','as','1'],['Andorra','ad','376'],
    ['Angola','ao','244'],['Anguilla','ai','1'],['Antigua and Barbuda','ag','1'],['Argentina','ar','54'],['Armenia','am','374'],
    ['Aruba','aw','297'],['Australia','au','61','0412 345 678'],['Austria','at','43'],['Azerbaijan','az','994'],['Bahamas','bs','1'],
    ['Bahrain','bh','973'],['Bangladesh','bd','880','01812-345678'],['Barbados','bb','1'],['Belarus','by','375'],['Belgium','be','32'],
    ['Belize','bz','501'],['Benin','bj','229'],['Bermuda','bm','1'],['Bhutan','bt','975'],['Bolivia','bo','591'],
    ['Bosnia and Herzegovina','ba','387'],['Botswana','bw','267'],['Brazil','br','55','(11) 96123-4567'],['British Virgin Islands','vg','1'],['Brunei','bn','673'],
    ['Bulgaria','bg','359'],['Burkina Faso','bf','226'],['Burundi','bi','257'],['Cambodia','kh','855'],['Cameroon','cm','237'],
    ['Canada','ca','1','(506) 234-5678'],['Cape Verde','cv','238'],['Cayman Islands','ky','1'],['Central African Republic','cf','236'],['Chad','td','235'],
    ['Chile','cl','56'],['China','cn','86'],['Colombia','co','57'],['Comoros','km','269'],['Congo (DRC)','cd','243'],
    ['Congo (Republic)','cg','242'],['Cook Islands','ck','682'],['Costa Rica','cr','506'],['Cote d\'Ivoire','ci','225'],['Croatia','hr','385'],
    ['Cuba','cu','53'],['Curacao','cw','599'],['Cyprus','cy','357'],['Czech Republic','cz','420'],['Denmark','dk','45'],
    ['Djibouti','dj','253'],['Dominica','dm','1'],['Dominican Republic','do','1'],['Ecuador','ec','593'],['Egypt','eg','20','0100 123 4567'],
    ['El Salvador','sv','503'],['Equatorial Guinea','gq','240'],['Eritrea','er','291'],['Estonia','ee','372'],['Eswatini','sz','268'],
    ['Ethiopia','et','251'],['Falkland Islands','fk','500'],['Faroe Islands','fo','298'],['Fiji','fj','679'],['Finland','fi','358'],
    ['France','fr','33','06 12 34 56 78'],['French Guiana','gf','594'],['French Polynesia','pf','689'],['Gabon','ga','241'],['Gambia','gm','220'],
    ['Georgia','ge','995'],['Germany','de','49','01512 3456789'],['Ghana','gh','233'],['Gibraltar','gi','350'],['Greece','gr','30'],
    ['Greenland','gl','299'],['Grenada','gd','1'],['Guadeloupe','gp','590'],['Guam','gu','1'],['Guatemala','gt','502'],
    ['Guinea','gn','224'],['Guinea-Bissau','gw','245'],['Guyana','gy','592'],['Haiti','ht','509'],['Honduras','hn','504'],
    ['Hong Kong','hk','852'],['Hungary','hu','36'],['Iceland','is','354'],['India','in','91','081234 56789'],['Indonesia','id','62'],
    ['Iran','ir','98'],['Iraq','iq','964'],['Ireland','ie','353'],['Israel','il','972'],['Italy','it','39','312 345 6789'],
    ['Jamaica','jm','1'],['Japan','jp','81'],['Jordan','jo','962'],['Kazakhstan','kz','7'],['Kenya','ke','254'],
    ['Kiribati','ki','686'],['Kosovo','xk','383'],['Kuwait','kw','965'],['Kyrgyzstan','kg','996'],['Laos','la','856'],
    ['Latvia','lv','371'],['Lebanon','lb','961'],['Lesotho','ls','266'],['Liberia','lr','231'],['Libya','ly','218'],
    ['Liechtenstein','li','423'],['Lithuania','lt','370'],['Luxembourg','lu','352'],['Macau','mo','853'],['Madagascar','mg','261'],
    ['Malawi','mw','265'],['Malaysia','my','60'],['Maldives','mv','960'],['Mali','ml','223'],['Malta','mt','356'],
    ['Marshall Islands','mh','692'],['Martinique','mq','596'],['Mauritania','mr','222'],['Mauritius','mu','230'],['Mexico','mx','52'],
    ['Micronesia','fm','691'],['Moldova','md','373'],['Monaco','mc','377'],['Mongolia','mn','976'],['Montenegro','me','382'],
    ['Montserrat','ms','1'],['Morocco','ma','212'],['Mozambique','mz','258'],['Myanmar (Burma)','mm','95'],['Namibia','na','264'],
    ['Nauru','nr','674'],['Nepal','np','977'],['Netherlands','nl','31','06 12345678'],['New Caledonia','nc','687'],['New Zealand','nz','64'],
    ['Nicaragua','ni','505'],['Niger','ne','227'],['Nigeria','ng','234','0802 123 4567'],['North Korea','kp','850'],['North Macedonia','mk','389'],
    ['Norway','no','47'],['Oman','om','968'],['Pakistan','pk','92','0301 2345678'],['Palau','pw','680'],['Palestine','ps','970'],
    ['Panama','pa','507'],['Papua New Guinea','pg','675'],['Paraguay','py','595'],['Peru','pe','51'],['Philippines','ph','63'],
    ['Poland','pl','48'],['Portugal','pt','351'],['Puerto Rico','pr','1'],['Qatar','qa','974'],['Reunion','re','262'],
    ['Romania','ro','40'],['Russia','ru','7'],['Rwanda','rw','250'],['Saint Kitts and Nevis','kn','1'],['Saint Lucia','lc','1'],
    ['Saint Vincent and the Grenadines','vc','1'],['Samoa','ws','685'],['San Marino','sm','378'],['Sao Tome and Principe','st','239'],['Saudi Arabia','sa','966','051 234 5678'],
    ['Senegal','sn','221'],['Serbia','rs','381'],['Seychelles','sc','248'],['Sierra Leone','sl','232'],['Singapore','sg','65','8123 4567'],
    ['Slovakia','sk','421'],['Slovenia','si','386'],['Solomon Islands','sb','677'],['Somalia','so','252'],['South Africa','za','27'],
    ['South Korea','kr','82'],['South Sudan','ss','211'],['Spain','es','34','612 34 56 78'],['Sri Lanka','lk','94'],['Sudan','sd','249'],
    ['Suriname','sr','597'],['Sweden','se','46'],['Switzerland','ch','41'],['Syria','sy','963'],['Taiwan','tw','886'],
    ['Tajikistan','tj','992'],['Tanzania','tz','255'],['Thailand','th','66'],['Timor-Leste','tl','670'],['Togo','tg','228'],
    ['Tonga','to','676'],['Trinidad and Tobago','tt','1'],['Tunisia','tn','216'],['Turkey','tr','90'],['Turkmenistan','tm','993'],
    ['Turks and Caicos Islands','tc','1'],['Tuvalu','tv','688'],['U.S. Virgin Islands','vi','1'],['Uganda','ug','256'],['Ukraine','ua','380'],
    ['United Arab Emirates','ae','971','050 123 4567'],['United Kingdom','gb','44','07400 123456'],['United States','us','1','(201) 555-0123'],['Uruguay','uy','598'],['Uzbekistan','uz','998'],
    ['Vanuatu','vu','678'],['Vatican City','va','39'],['Venezuela','ve','58'],['Vietnam','vn','84'],['Wallis and Futuna','wf','681'],
    ['Western Sahara','eh','212'],['Yemen','ye','967'],['Zambia','zm','260'],['Zimbabwe','zw','263']
  ];
  window.FXCountries = C.map(function (c) {
    return { name: c[0], iso2: c[1], dialCode: c[2], placeholder: c[3] || '' };
  });
})();
