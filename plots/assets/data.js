const RAW_RECORDS = [
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.15185400000000002,
    "gflops": 3.4525794513150787
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.024908,
    "gflops": 21.0489802473101
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.025054,
    "gflops": 20.92631915063463
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.030208,
    "gflops": 17.35593220338983
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.019608,
    "gflops": 26.738474092207262
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.02155,
    "gflops": 24.328909512761022
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.046900000000000004,
    "gflops": 11.178848614072495
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.057592,
    "gflops": 9.103486595360465
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.042416999999999996,
    "gflops": 12.360327227290945
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.033433000000000004,
    "gflops": 15.681751562827145
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.042321,
    "gflops": 12.388365114245884
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.038238,
    "gflops": 13.711177362832784
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.03535,
    "gflops": 14.831343705799153
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.0303,
    "gflops": 17.303234323432342
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.018958,
    "gflops": 27.655237894292643
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.036558,
    "gflops": 14.341265933584989
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.040254,
    "gflops": 13.024494460177872
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.0499,
    "gflops": 10.50677354709419
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.038408000000000005,
    "gflops": 13.650489481358049
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.019796,
    "gflops": 26.484542331784194
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.038092,
    "gflops": 13.763729917042948
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.043692,
    "gflops": 11.99963380023803
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.048184,
    "gflops": 10.880956334052797
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.380458,
    "gflops": 3.038342347249971
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.134146,
    "gflops": 31.2667094061694
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.205392,
    "gflops": 20.42097063176755
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.14077499999999998,
    "gflops": 29.79438110459954
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.076067,
    "gflops": 55.13960061524708
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.054008,
    "gflops": 77.66079099392682
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.08600000000000001,
    "gflops": 48.770976744186044
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.107846,
    "gflops": 38.89160469558444
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.21756299999999998,
    "gflops": 19.278572183689324
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.108767,
    "gflops": 38.562284516443405
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.11265800000000001,
    "gflops": 37.23041417387136
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.14149599999999998,
    "gflops": 29.642562333917567
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.146525,
    "gflops": 28.625176591025422
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.147908,
    "gflops": 28.357519539172998
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.09476599999999999,
    "gflops": 44.259586771626964
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.07800399999999999,
    "gflops": 53.77037075021794
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.087379,
    "gflops": 48.001281772508264
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.075658,
    "gflops": 55.43768008670596
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.212704,
    "gflops": 19.71897096434482
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.11315900000000001,
    "gflops": 37.065580289680895
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.117608,
    "gflops": 35.66342425685327
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.109787,
    "gflops": 38.204013225609586
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.090408,
    "gflops": 46.39306256083532
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 14.939604000000001,
    "gflops": 2.2460054496759088
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.379067,
    "gflops": 24.33125584181189
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.681067,
    "gflops": 19.960199087841232
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.368479,
    "gflops": 24.51950815467391
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.727104,
    "gflops": 46.148050347680666
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.458075,
    "gflops": 73.25095672106096
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.306754,
    "gflops": 109.38547500603089
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.391742,
    "gflops": 85.65441540605808
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.737913,
    "gflops": 19.30731400248459
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.848192,
    "gflops": 39.55994869086245
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.467921,
    "gflops": 71.70960910068152
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.4642,
    "gflops": 72.284429125377
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.49239200000000005,
    "gflops": 68.14577003688117
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.337921,
    "gflops": 25.07953160164165
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.7054039999999999,
    "gflops": 47.56768036472717
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.38832500000000003,
    "gflops": 86.4081169123801
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.33240400000000003,
    "gflops": 100.94472990698065
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.329792,
    "gflops": 101.74422666407918
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.643384,
    "gflops": 20.417888941355155
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.856617,
    "gflops": 39.17086866125702
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.457787,
    "gflops": 73.29703988973037
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.406312,
    "gflops": 82.58292149874974
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.453433,
    "gflops": 74.00086010502103
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 121.95412499999999,
    "gflops": 2.201118297556561
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.633633,
    "gflops": 25.244002308524284
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.896221,
    "gflops": 19.31715507403056
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.538313,
    "gflops": 25.47233660643786
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.298862,
    "gflops": 50.6590766092795
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.743071,
    "gflops": 97.8594633533
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 2.846146,
    "gflops": 94.31542022088819
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 2.255312,
    "gflops": 119.02364550891406
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 14.798340999999999,
    "gflops": 18.139564157901216
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 9.070908000000001,
    "gflops": 29.593008329485865
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 5.052375,
    "gflops": 53.13054870234296
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 3.2033919999999996,
    "gflops": 83.79725490979563
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 3.710896,
    "gflops": 72.33710025826646
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 11.184713,
    "gflops": 24.000209571761026
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.6623790000000005,
    "gflops": 47.40683306433568
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.7894539999999997,
    "gflops": 96.23225763895013
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.928288,
    "gflops": 139.20921356145968
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 2.234179,
    "gflops": 120.14948488908004
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 14.454533,
    "gflops": 18.571022391384073
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 7.443563,
    "gflops": 36.06276402846325
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.664404,
    "gflops": 73.25487473542765
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 3.079408,
    "gflops": 87.17112380041878
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 3.222808,
    "gflops": 83.29241332403295
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1094.032083,
    "gflops": 1.962907378466706
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 84.470963,
    "gflops": 25.42274376580743
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 123.30785800000001,
    "gflops": 17.415626893786445
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 83.756892,
    "gflops": 25.639485858668206
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.408192,
    "gflops": 50.6384155212276
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.596621,
    "gflops": 99.43609456312633
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.284554,
    "gflops": 190.30292628313
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 10.788692000000001,
    "gflops": 199.04949070749262
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 123.590933,
    "gflops": 17.375737814035276
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 63.849779,
    "gflops": 33.63337636611084
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.743716999999997,
    "gflops": 67.65066762660467
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 17.473504000000002,
    "gflops": 122.89942807120998
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 19.738542000000002,
    "gflops": 108.79646774315954
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 84.221171,
    "gflops": 25.49814521101826
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.868158,
    "gflops": 50.09507635014315
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 23.205229,
    "gflops": 92.5430922487341
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 12.056567000000001,
    "gflops": 178.11734036728694
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 14.837746000000001,
    "gflops": 144.73112344691705
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 121.604467,
    "gflops": 17.65957864031426
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 62.206279,
    "gflops": 34.52197563528916
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.912029,
    "gflops": 67.29386113305425
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 16.581304000000003,
    "gflops": 129.51235005401264
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 20.624829000000002,
    "gflops": 104.1212825570578
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 23438.920516,
    "gflops": 0.732963327908919
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 724.576054,
    "gflops": 23.710235922314926
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1177.1664420000002,
    "gflops": 14.594256658227094
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 715.982925,
    "gflops": 23.994802926340736
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 383.354158,
    "gflops": 44.81461548148905
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 230.47999099999998,
    "gflops": 74.53952557643062
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 111.376138,
    "gflops": 154.2508969380856
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 121.807221,
    "gflops": 141.04146735274423
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1183.3017459999999,
    "gflops": 14.518586862627684
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 704.380079,
    "gflops": 24.390055449026974
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 308.42886699999997,
    "gflops": 55.701236239991765
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 156.53035,
    "gflops": 109.7542373348044
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 162.85316699999998,
    "gflops": 105.49300023130654
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 716.8349830000001,
    "gflops": 23.96628176836621
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 383.83598800000004,
    "gflops": 44.75835961478422
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 233.006475,
    "gflops": 73.73129516679741
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 111.483179,
    "gflops": 154.1027923504047
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 130.743621,
    "gflops": 131.40120376503876
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1184.955496,
    "gflops": 14.498324402893862
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 638.2127869999999,
    "gflops": 26.91871666306805
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 315.681737,
    "gflops": 54.42148585237923
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 170.993687,
    "gflops": 100.4707804446605
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 163.245775,
    "gflops": 105.23928833073933
  }
];
