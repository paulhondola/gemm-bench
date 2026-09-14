const RAW_RECORDS = [
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.32171700000000003,
    "gflops": 1.6296558776813161
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.051761999999999996,
    "gflops": 10.128820370155713
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.052367000000000004,
    "gflops": 10.011801325262093
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.08502900000000001,
    "gflops": 6.165990426795564
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.049892000000000006,
    "gflops": 10.508458269862903
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.035292,
    "gflops": 14.855718009747251
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.060578999999999994,
    "gflops": 8.654616286171775
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.053962,
    "gflops": 9.715874133649605
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.0596,
    "gflops": 8.796778523489934
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.052496,
    "gflops": 9.987199024687595
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.0522,
    "gflops": 10.04383141762452
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.053063,
    "gflops": 9.880481691574166
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.066675,
    "gflops": 7.863337082864642
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.052696,
    "gflops": 9.949294064065585
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.032833999999999995,
    "gflops": 15.967838216482916
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.048028999999999995,
    "gflops": 10.916071540111183
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.072654,
    "gflops": 7.21623035207972
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.058154,
    "gflops": 9.015510540977406
  },
  {
    "kernel": "mps",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.235958,
    "gflops": 2.2219547546597274
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.448383,
    "gflops": 2.8958528234589886
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.13425,
    "gflops": 31.24248789571694
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.20497500000000002,
    "gflops": 20.462514940846443
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.14016199999999998,
    "gflops": 29.924687147729056
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.07925399999999999,
    "gflops": 52.92230045171222
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.052221000000000004,
    "gflops": 80.3183393653894
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.065392,
    "gflops": 64.14093467090775
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.080138,
    "gflops": 52.33851605979685
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.208979,
    "gflops": 20.070456840160972
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.109529,
    "gflops": 38.294004327620996
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.115387,
    "gflops": 36.34988343574233
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.140446,
    "gflops": 29.86417555501759
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.13273700000000002,
    "gflops": 31.598604759788152
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.13880399999999998,
    "gflops": 30.21745771015245
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.075254,
    "gflops": 55.73529646264651
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.073408,
    "gflops": 57.13687881429817
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.099054,
    "gflops": 42.34361055585842
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.080238,
    "gflops": 52.2732869712605
  },
  {
    "kernel": "mps",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.350746,
    "gflops": 11.958237585033045
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 14.052004,
    "gflops": 2.387875209827723
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.306658,
    "gflops": 25.679582568659892
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.6087,
    "gflops": 20.85810405917822
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.295725,
    "gflops": 25.896260394759693
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.720196,
    "gflops": 46.59069475531661
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.384713,
    "gflops": 87.21938691959981
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.250933,
    "gflops": 133.71868984948173
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.24640000000000004,
    "gflops": 136.17870129870127
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.603988,
    "gflops": 20.919378449215333
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.8284670000000001,
    "gflops": 40.50183290342283
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.466113,
    "gflops": 71.98776262408472
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.457975,
    "gflops": 73.26695125279764
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.48903300000000005,
    "gflops": 68.61383996581007
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.291492,
    "gflops": 25.981138094544914
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.701079,
    "gflops": 47.86112834644884
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.393271,
    "gflops": 85.32139923869292
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.32285400000000003,
    "gflops": 103.93066835163881
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.328571,
    "gflops": 102.12231755084899
  },
  {
    "kernel": "mps",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.4506,
    "gflops": 74.46611628939192
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.801112,
    "gflops": 2.240675829453069
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.146096,
    "gflops": 26.45701913327057
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.408504,
    "gflops": 20.019791618811468
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.156942,
    "gflops": 26.428767241163726
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.29855,
    "gflops": 50.66205962008474
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.772929,
    "gflops": 96.80574439518647
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.596229,
    "gflops": 168.16851216210205
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.4501620000000002,
    "gflops": 185.10721974510435
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.506017,
    "gflops": 19.87524937959133
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 6.974317,
    "gflops": 38.48913893647221
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.6994749999999996,
    "gflops": 72.56041897836856
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 2.181833,
    "gflops": 123.03208174044484
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 2.006383,
    "gflops": 133.79073486966348
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.312879,
    "gflops": 26.02914821360747
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.317258,
    "gflops": 50.48381252141611
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.781754,
    "gflops": 96.49863215798378
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.565204,
    "gflops": 171.50189751623432
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.907863,
    "gflops": 140.69954498829318
  },
  {
    "kernel": "mps",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.76975,
    "gflops": 348.73069957778495
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1077.834634,
    "gflops": 1.9924054954797454
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 83.124275,
    "gflops": 25.83461507483825
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.023433,
    "gflops": 18.042528213750984
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 82.460129,
    "gflops": 26.04269086214988
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.291729000000004,
    "gflops": 50.77786363380887
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.668629,
    "gflops": 99.10565398484603
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.310412000000001,
    "gflops": 189.86785344335817
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 10.856788,
    "gflops": 197.80101149621785
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.92965,
    "gflops": 17.906194573235226
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 65.718442,
    "gflops": 32.67703224005219
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.732267,
    "gflops": 67.67507811528246
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 17.048113,
    "gflops": 125.96606134649623
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 15.819099999999999,
    "gflops": 135.75258061457353
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 82.292263,
    "gflops": 26.095814718328988
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.018113,
    "gflops": 51.10852188911957
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.622508,
    "gflops": 99.31704721764932
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 12.062763,
    "gflops": 178.02585095968476
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 14.437183,
    "gflops": 148.7467221271629
  },
  {
    "kernel": "mps",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.427304,
    "gflops": 1504.573411130355
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 23001.582863,
    "gflops": 0.7468994323705992
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 713.114917,
    "gflops": 24.09130530640688
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1176.524208,
    "gflops": 14.602223283789838
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 713.183933,
    "gflops": 24.08897395056711
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 393.172871,
    "gflops": 43.695459303447215
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 232.803342,
    "gflops": 73.79562954899505
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 118.77053699999999,
    "gflops": 144.64756679512192
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 116.832117,
    "gflops": 147.0474868139212
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1189.686358,
    "gflops": 14.440670911685785
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 643.4524289999999,
    "gflops": 26.699517182178514
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 314.52385799999996,
    "gflops": 54.621831530503485
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 157.450963,
    "gflops": 109.1125062474213
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 160.559033,
    "gflops": 107.00032793545788
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 713.7950870000001,
    "gflops": 24.06834888175687
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 396.00818300000003,
    "gflops": 43.38261157598352
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 229.024492,
    "gflops": 75.01323999880327
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 121.1409,
    "gflops": 141.81724903810357
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 126.453691,
    "gflops": 135.85897768693837
  },
  {
    "kernel": "mps",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5.048729,
    "gflops": 3402.810724045596
  }
];
