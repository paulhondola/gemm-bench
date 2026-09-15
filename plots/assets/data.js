const RAW_RECORDS = [
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.21554199999999998,
    "gflops": 2.4324168839483717
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.027541,
    "gflops": 19.036636287716494
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.027667,
    "gflops": 18.94994036216431
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.031834,
    "gflops": 16.469435195074446
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.036875000000000005,
    "gflops": 14.21797966101695
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.030625,
    "gflops": 17.119608163265305
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.049082999999999995,
    "gflops": 10.681661675121733
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.14725,
    "gflops": 3.5605297113752123
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.074125,
    "gflops": 7.073025295109613
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.076667,
    "gflops": 6.838509397785227
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.071916,
    "gflops": 7.290283108070527
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.087333,
    "gflops": 6.003320623361159
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.090917,
    "gflops": 5.766666300031898
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.06679199999999999,
    "gflops": 7.849562821894838
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.053625,
    "gflops": 9.7769324009324
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.057166,
    "gflops": 9.171325613126685
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.080375,
    "gflops": 6.5230233281493
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.053333,
    "gflops": 9.830461440384003
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.074292,
    "gflops": 7.057125935497766
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.041667,
    "gflops": 12.5828113375093
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.054958,
    "gflops": 9.539794024527822
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.051625000000000004,
    "gflops": 10.155699757869249
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.044792,
    "gflops": 11.704947312020005
  },
  {
    "kernel": "mps",
    "n": 64,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.290083,
    "gflops": 1.8073723727347
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 1.421625,
    "gflops": 2.9503589202497142
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.10475,
    "gflops": 40.04108830548926
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.160458,
    "gflops": 26.139575465230777
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.108167,
    "gflops": 38.77618867122135
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.058208,
    "gflops": 72.0571742715778
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.044417,
    "gflops": 94.43015061800662
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.035292,
    "gflops": 118.84574407797801
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.06166700000000001,
    "gflops": 68.01537288987626
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.16541599999999998,
    "gflops": 25.35609614547565
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.08683400000000001,
    "gflops": 48.3025542990073
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.090125,
    "gflops": 46.53874063800278
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.108,
    "gflops": 38.83614814814815
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.101458,
    "gflops": 41.34029844861913
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.110042,
    "gflops": 38.11548317914978
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.059916,
    "gflops": 70.0030709660191
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.055292,
    "gflops": 75.85733921724662
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.06724999999999999,
    "gflops": 62.36883271375466
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.07175,
    "gflops": 58.45719860627178
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.16683299999999998,
    "gflops": 25.14073354791918
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.087334,
    "gflops": 48.02601506858726
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.057834,
    "gflops": 72.52315247086489
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.073459,
    "gflops": 57.09721068895574
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.059709,
    "gflops": 70.24575859585657
  },
  {
    "kernel": "mps",
    "n": 128,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.231542,
    "gflops": 18.114657383973533
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 13.436625000000001,
    "gflops": 2.4972366200589806
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.554,
    "gflops": 60.56756678700361
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 1.222667,
    "gflops": 27.443639192028577
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.585083,
    "gflops": 57.3498666001234
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.316208,
    "gflops": 106.11506350250468
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.179917,
    "gflops": 186.49950810651578
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.11950000000000001,
    "gflops": 280.7902259414226
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.16483399999999998,
    "gflops": 203.56499265928147
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 1.2348750000000002,
    "gflops": 27.17233080271282
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.642708,
    "gflops": 52.20789534283065
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.336375,
    "gflops": 99.75304942400595
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.363209,
    "gflops": 92.38326142799325
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.365417,
    "gflops": 91.82504371717792
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.6948749999999999,
    "gflops": 48.28844324518799
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.316416,
    "gflops": 106.0453074433657
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.21954200000000001,
    "gflops": 152.83832706270326
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.143917,
    "gflops": 233.15127469305224
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.18925,
    "gflops": 177.30215059445177
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 1.2645410000000001,
    "gflops": 26.5348707554757
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 0.647459,
    "gflops": 51.82479817254838
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 0.35991700000000004,
    "gflops": 93.22824984649239
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.234292,
    "gflops": 143.21629419698496
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.41475,
    "gflops": 80.90278963230861
  },
  {
    "kernel": "mps",
    "n": 256,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.313834,
    "gflops": 106.91777181567326
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 120.245375,
    "gflops": 2.232397345843863
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 5.09425,
    "gflops": 52.69381282818865
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 9.844166,
    "gflops": 27.268481250722512
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 5.096375,
    "gflops": 52.671841455936814
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 2.70675,
    "gflops": 99.17260773990948
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1.392458,
    "gflops": 192.7781347803668
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.9975419999999999,
    "gflops": 269.09689617078783
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.693875,
    "gflops": 386.8642853539902
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 9.949833,
    "gflops": 26.978890600475406
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 5.103458,
    "gflops": 52.5987391294295
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 2.683584,
    "gflops": 100.02871383940281
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 1.40825,
    "gflops": 190.6163365879638
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 1.452667,
    "gflops": 184.7880181762235
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 5.163125,
    "gflops": 51.990888463866355
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 2.721625,
    "gflops": 98.63058136223762
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1.427792,
    "gflops": 188.00739603527686
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 0.749792,
    "gflops": 358.0132303358798
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 0.9951249999999999,
    "gflops": 269.7504896369803
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 9.877584,
    "gflops": 27.17622608929471
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 5.2638750000000005,
    "gflops": 50.9957884638218
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 2.6629169999999998,
    "gflops": 100.80504048755557
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 1.3989580000000001,
    "gflops": 191.8824267776445
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 2.1287089999999997,
    "gflops": 126.10246680030009
  },
  {
    "kernel": "mps",
    "n": 512,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 0.441542,
    "gflops": 607.9499934321084
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 983.1776669999999,
    "gflops": 2.1842274495032847
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 40.387833,
    "gflops": 53.17154916432382
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 81.814083,
    "gflops": 26.24833731864965
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 40.626957999999995,
    "gflops": 52.85858832945357
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 21.028499999999998,
    "gflops": 102.12253123142402
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 10.949083,
    "gflops": 196.13365320182524
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 5.676708,
    "gflops": 378.2973596669055
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 5.360708,
    "gflops": 400.5970196474048
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 82.374667,
    "gflops": 26.06970961108711
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 42.503209,
    "gflops": 50.525212061046965
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 21.722333,
    "gflops": 98.86063564166886
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 11.929959,
    "gflops": 180.00763020224963
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 11.687291,
    "gflops": 183.74520220297416
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 41.03825,
    "gflops": 52.32883098085323
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 21.026041,
    "gflops": 102.13447448333237
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 10.883959,
    "gflops": 197.30721587613476
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 6.554042000000001,
    "gflops": 327.6579014904085
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 7.1575,
    "gflops": 300.0326438002096
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 82.6785,
    "gflops": 25.973906735124608
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 42.425042000000005,
    "gflops": 50.61830340674736
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 21.900167000000003,
    "gflops": 98.05786631672717
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 11.815958,
    "gflops": 181.74435352596888
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 13.011333,
    "gflops": 165.04716680450804
  },
  {
    "kernel": "mps",
    "n": 1024,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 4.0475,
    "gflops": 530.5703886349598
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 9007.896,
    "gflops": 1.9072011026770288
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 334.237042,
    "gflops": 51.40025498430542
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 707.9159579999999,
    "gflops": 24.268232676286132
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 342.930583,
    "gflops": 50.09722094106724
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 171.220959,
    "gflops": 100.33741946276565
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 89.183542,
    "gflops": 192.6349727621269
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 44.579458,
    "gflops": 385.37635841153565
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 41.678166000000004,
    "gflops": 412.2030989559377
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 706.357125,
    "gflops": 24.32178932717639
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 360.812917,
    "gflops": 47.61434076929125
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 187.370125,
    "gflops": 91.68947922727808
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 98.3965,
    "gflops": 174.59837681218335
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 97.138042,
    "gflops": 176.86036109313386
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 332.609375,
    "gflops": 51.65178878075821
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 169.483292,
    "gflops": 101.36615226945203
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 87.91054199999999,
    "gflops": 195.42444845807003
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 50.264207999999996,
    "gflops": 341.7913037444059
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 57.242292,
    "gflops": 300.1254594068316
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 709.378667,
    "gflops": 24.218192600370376
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 366.88491600000003,
    "gflops": 46.82631646813193
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 188.327458,
    "gflops": 91.22339018668218
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 96.570125,
    "gflops": 177.9004550734505
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 94.870042,
    "gflops": 181.08845344455523
  },
  {
    "kernel": "mps",
    "n": 2048,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 6.3245000000000005,
    "gflops": 2716.399586370464
  },
  {
    "kernel": "naive-ijk",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 202459.413875,
    "gflops": 0.67884693945057
  },
  {
    "kernel": "ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 2720.098209,
    "gflops": 50.527202663953524
  },
  {
    "kernel": "tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 6127.123667,
    "gflops": 22.43123542817175
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 2717.411542,
    "gflops": 50.57715820653565
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 1524.443125,
    "gflops": 90.15682593734024
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1031.01325,
    "gflops": 133.30474023684954
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 481.305042,
    "gflops": 285.55477603328325
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 584.5075410000001,
    "gflops": 235.13632217107698
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 6213.960042,
    "gflops": 22.117772329247945
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 3264.73075,
    "gflops": 42.09809751447344
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1667.347417,
    "gflops": 82.42970365425649
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 861.471458,
    "gflops": 159.53976442943278
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 922.918041,
    "gflops": 148.91783166691832
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 2724.319916,
    "gflops": 50.44890384011714
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 1513.049708,
    "gflops": 90.83571593538154
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1029.547,
    "gflops": 133.4945888550984
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 502.38258300000007,
    "gflops": 273.57428008605945
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 565.792041,
    "gflops": 242.91425738171526
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 6227.074292,
    "gflops": 22.071192188692777
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f16",
    "elapsed_ms": 3295.458459,
    "gflops": 41.70556393956353
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f16",
    "elapsed_ms": 1687.9309170000001,
    "gflops": 81.4245133422128
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f16",
    "elapsed_ms": 864.4340000000001,
    "gflops": 158.9929982763288
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f16",
    "elapsed_ms": 824.4295000000001,
    "gflops": 166.70795194980286
  },
  {
    "kernel": "mps",
    "n": 4096,
    "threads": 1,
    "precision": "f16",
    "elapsed_ms": 38.065291,
    "gflops": 3610.6108704646444
  },
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.19487500000000002,
    "gflops": 2.690381013470173
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.032042,
    "gflops": 16.362524187004556
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.032334,
    "gflops": 16.214758458588484
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.037375,
    "gflops": 14.027772575250836
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.073208,
    "gflops": 7.161621680690636
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.027375,
    "gflops": 19.152073059360728
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.041167,
    "gflops": 12.735637768115238
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.057584,
    "gflops": 9.104751319811058
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.051,
    "gflops": 10.280156862745098
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.050542,
    "gflops": 10.373313284001425
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.040375,
    "gflops": 12.985461300309597
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.06483299999999999,
    "gflops": 8.086745947279935
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.041665999999999995,
    "gflops": 12.583113329813278
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.043792,
    "gflops": 11.972232371209355
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.023458,
    "gflops": 22.350072469946284
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.03975,
    "gflops": 13.189635220125787
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.065292,
    "gflops": 8.02989646511058
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.035875,
    "gflops": 14.614299651567945
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.046458,
    "gflops": 11.285203840027553
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.042957999999999996,
    "gflops": 12.204665021649054
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.040333,
    "gflops": 12.998983462673245
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.046625,
    "gflops": 11.244782841823055
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.03325,
    "gflops": 15.768060150375938
  },
  {
    "kernel": "mps",
    "n": 64,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.231,
    "gflops": 2.2696450216450215
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.4113330000000002,
    "gflops": 2.9718741076698407
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.134125,
    "gflops": 31.271604846225536
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.20441700000000002,
    "gflops": 20.518371759687305
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.137791,
    "gflops": 30.43960781183096
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.073625,
    "gflops": 56.9684753820034
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.102833,
    "gflops": 40.78752929507065
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.14008400000000001,
    "gflops": 29.941349476028666
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.075334,
    "gflops": 55.676109060981766
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.20566700000000002,
    "gflops": 20.393665488386567
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.110375,
    "gflops": 38.00048924122311
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.110917,
    "gflops": 37.814798452897215
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.124583,
    "gflops": 33.666744258847515
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.122667,
    "gflops": 34.192602737492564
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.142292,
    "gflops": 29.476737975430805
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.078625,
    "gflops": 53.345678855325914
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.051,
    "gflops": 82.24125490196079
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.082792,
    "gflops": 50.660740168132186
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.08904100000000001,
    "gflops": 47.10531103648881
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.21333300000000002,
    "gflops": 19.660830720048
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.113541,
    "gflops": 36.94087598312504
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.067833,
    "gflops": 61.83279524715109
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.06933299999999999,
    "gflops": 60.4950600724042
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.09575,
    "gflops": 43.804741514360316
  },
  {
    "kernel": "mps",
    "n": 128,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.22375,
    "gflops": 18.74549273743017
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.663333999999999,
    "gflops": 2.455801197570081
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.275083,
    "gflops": 26.315488481926273
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.579708,
    "gflops": 21.24090781334272
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.286875,
    "gflops": 26.074352209810584
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.92725,
    "gflops": 36.18703909409545
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.3765,
    "gflops": 89.1219973439575
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.24787499999999998,
    "gflops": 135.36835905194152
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.320917,
    "gflops": 104.55797604988207
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.596,
    "gflops": 21.024080200501256
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.8296659999999999,
    "gflops": 40.443301280274234
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.54075,
    "gflops": 62.0516541840037
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.437708,
    "gflops": 76.65939850311166
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.5109999999999999,
    "gflops": 65.66425048923679
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.291875,
    "gflops": 25.973435510401547
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.715666,
    "gflops": 46.88560306064561
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.394375,
    "gflops": 85.08255340729002
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.341584,
    "gflops": 98.23186097709495
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.336542,
    "gflops": 99.70354963124959
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1.615,
    "gflops": 20.776738080495356
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 0.827708,
    "gflops": 40.53897268118708
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 0.475417,
    "gflops": 70.57894858618856
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 0.287125,
    "gflops": 116.8634984762734
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 0.39725,
    "gflops": 84.46678917558214
  },
  {
    "kernel": "mps",
    "n": 256,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.28033399999999997,
    "gflops": 119.69447872894476
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 117.908208,
    "gflops": 2.276647746185745
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.663667,
    "gflops": 25.1729030923415
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.791584,
    "gflops": 19.463714682809456
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.195124999999999,
    "gflops": 26.32978565736075
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.2715000000000005,
    "gflops": 50.922025230010426
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.779792,
    "gflops": 96.5667416842699
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.487875,
    "gflops": 180.41532790052926
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.542167,
    "gflops": 174.06380502241328
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.452375,
    "gflops": 19.954502903762343
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 6.952500000000001,
    "gflops": 38.60991815893563
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.6444170000000002,
    "gflops": 73.65662491421811
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.965541,
    "gflops": 136.57077415327385
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.9719579999999999,
    "gflops": 136.12635563232078
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.186625,
    "gflops": 26.35175595449916
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 5.268958,
    "gflops": 50.946592476159424
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2.7690409999999996,
    "gflops": 96.9416689749267
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.4265,
    "gflops": 188.17767683140553
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1.908208,
    "gflops": 140.67410680596663
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 13.437917,
    "gflops": 19.975972168900878
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 6.949625,
    "gflops": 38.62589074950087
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 3.681708,
    "gflops": 72.91057737332781
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1.9094579999999999,
    "gflops": 140.5820164675002
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 2.957375,
    "gflops": 90.76814945686631
  },
  {
    "kernel": "mps",
    "n": 512,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 0.39829200000000003,
    "gflops": 673.9664768561759
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1038.187333,
    "gflops": 2.0684934016624146
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 82.50745900000001,
    "gflops": 26.027751600009886
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.613833,
    "gflops": 17.953472388097452
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 81.755375,
    "gflops": 26.26718607797958
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 41.734042,
    "gflops": 51.45640213809149
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.874875,
    "gflops": 98.17124202995447
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.441583999999999,
    "gflops": 187.69111409748862
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 11.656417000000001,
    "gflops": 184.2318825759236
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 119.173209,
    "gflops": 18.019852498895116
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 61.561334,
    "gflops": 34.883643814476144
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.5985,
    "gflops": 67.96156931499912
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 18.051917,
    "gflops": 118.96152901655819
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 15.949749999999998,
    "gflops": 134.6405835828148
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 81.784958,
    "gflops": 26.25768479333327
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 42.122416,
    "gflops": 50.981967606036655
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 21.310708,
    "gflops": 100.77016906242626
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 11.644209,
    "gflops": 184.42503462450733
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 14.45725,
    "gflops": 148.54025820954885
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 120.2085,
    "gflops": 17.864657224738686
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 61.548167,
    "gflops": 34.89110647275653
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 31.59425,
    "gflops": 67.97071137944405
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 15.628625,
    "gflops": 137.4070750305929
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 19.048625,
    "gflops": 112.73693760048297
  },
  {
    "kernel": "mps",
    "n": 1024,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 4.596834,
    "gflops": 467.1658032463212
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 24071.668125,
    "gflops": 0.7136966617680137
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 719.354666,
    "gflops": 23.882335092826104
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1166.603833,
    "gflops": 14.726395283496382
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 709.5198750000001,
    "gflops": 24.213372717712804
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 411.06816699999996,
    "gflops": 41.793236653131544
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 227.992084,
    "gflops": 75.35291963908712
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 119.880125,
    "gflops": 143.3087359893894
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 115.401625,
    "gflops": 148.87025363810952
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1177.901417,
    "gflops": 14.58515028172345
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 623.2021669999999,
    "gflops": 27.5670883281765
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 314.71375,
    "gflops": 54.58887380675296
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 168.71070799999998,
    "gflops": 101.83034252929578
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 161.511083,
    "gflops": 106.36959931721837
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 715.855334,
    "gflops": 23.999079657622556
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 412.237,
    "gflops": 41.67473852177267
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 228.434791,
    "gflops": 75.20688555711288
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 122.585708,
    "gflops": 140.14577608019363
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 122.04216699999999,
    "gflops": 140.76994539108767
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 1170.5895,
    "gflops": 14.676254300931284
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 651.660083,
    "gflops": 26.363236957694706
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 304.261417,
    "gflops": 56.46417266241812
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 154.467625,
    "gflops": 111.21987007957169
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 143.120916,
    "gflops": 120.0374457077958
  },
  {
    "kernel": "mps",
    "n": 2048,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 10.833499999999999,
    "gflops": 1585.8096814510548
  },
  {
    "kernel": "naive-ijk",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 268953.293708,
    "gflops": 0.5110142046492882
  },
  {
    "kernel": "ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5459.0305,
    "gflops": 25.176439932328645
  },
  {
    "kernel": "tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 8610.052791999999,
    "gflops": 15.962614491713794
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5403.81275,
    "gflops": 25.43370020954186
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 2952.9432079999997,
    "gflops": 46.54303987278038
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2164.737541,
    "gflops": 63.489892362891304
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1099.456459,
    "gflops": 125.00627227840043
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1166.248875,
    "gflops": 117.84701912102595
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 8975.901333,
    "gflops": 15.31199468143708
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 4562.543291,
    "gflops": 30.123320417169495
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2333.0378330000003,
    "gflops": 58.90986915341634
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1259.4695,
    "gflops": 109.12447937167197
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1323.22,
    "gflops": 103.86704665286196
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 5506.955292,
    "gflops": 24.95733961589605
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 3207.229208,
    "gflops": 42.85286287901628
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2306.33225,
    "gflops": 59.59200088018541
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1421.502292,
    "gflops": 96.68570655530115
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1203.949333,
    "gflops": 114.15675868147186
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 9401.160125,
    "gflops": 14.619360977217692
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f32",
    "elapsed_ms": 4697.3335,
    "gflops": 29.258930299924415
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f32",
    "elapsed_ms": 2336.919667,
    "gflops": 58.81201455608272
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f32",
    "elapsed_ms": 1274.8842499999998,
    "gflops": 107.80504463209111
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f32",
    "elapsed_ms": 1443.61675,
    "gflops": 95.2045987773417
  },
  {
    "kernel": "mps",
    "n": 4096,
    "threads": 1,
    "precision": "f32",
    "elapsed_ms": 39.290375000000004,
    "gflops": 3498.0310946892205
  },
  {
    "kernel": "naive-ijk",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.312875,
    "gflops": 1.6757107471034758
  },
  {
    "kernel": "ikj",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.069416,
    "gflops": 7.552840843609543
  },
  {
    "kernel": "tiled",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.06999999999999999,
    "gflops": 7.489828571428571
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.077958,
    "gflops": 6.725262320736807
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.0635,
    "gflops": 8.256503937007874
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.079917,
    "gflops": 6.560406421662474
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.148209,
    "gflops": 3.5374909755817794
  },
  {
    "kernel": "rayon-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.11175,
    "gflops": 4.691615212527964
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.077333,
    "gflops": 6.779615429376851
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.0795,
    "gflops": 6.5948176100628935
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.089834,
    "gflops": 5.836186744439745
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.096916,
    "gflops": 5.409715630030129
  },
  {
    "kernel": "rayon-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.099541,
    "gflops": 5.267055786058006
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.07725,
    "gflops": 6.7868996763754055
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.075125,
    "gflops": 6.97887520798669
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.072833,
    "gflops": 7.198495187620996
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.069084,
    "gflops": 7.589137861154536
  },
  {
    "kernel": "static-ikj",
    "n": 64,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.053458000000000006,
    "gflops": 9.807475027124099
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.085459,
    "gflops": 6.134965305000059
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.042917000000000004,
    "gflops": 12.216324533401682
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.058332999999999996,
    "gflops": 8.987845644832257
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.097334,
    "gflops": 5.386483654221546
  },
  {
    "kernel": "static-tiled",
    "n": 64,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.128167,
    "gflops": 4.090662963165245
  },
  {
    "kernel": "naive-ijk",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.56725,
    "gflops": 1.6337731035154348
  },
  {
    "kernel": "ikj",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.459417,
    "gflops": 9.129622978688207
  },
  {
    "kernel": "tiled",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.435959,
    "gflops": 9.620868017405307
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.47804199999999997,
    "gflops": 8.773923630141285
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.26275000000000004,
    "gflops": 15.963098001902948
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.197958,
    "gflops": 21.187847927338122
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.111,
    "gflops": 37.786522522522525
  },
  {
    "kernel": "rayon-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.175875,
    "gflops": 23.848210376687987
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.463542,
    "gflops": 9.048379650603398
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.228625,
    "gflops": 18.345780207763806
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.29125,
    "gflops": 14.401043776824034
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.24533299999999997,
    "gflops": 17.09637105485198
  },
  {
    "kernel": "rayon-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.244791,
    "gflops": 17.13422470597367
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.425542,
    "gflops": 9.85638080377495
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.224459,
    "gflops": 18.68628123621686
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.127625,
    "gflops": 32.86428207639569
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.235458,
    "gflops": 17.813384977363267
  },
  {
    "kernel": "static-ikj",
    "n": 128,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.16229100000000002,
    "gflops": 25.84434133747404
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 0.403042,
    "gflops": 10.406617672599879
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 0.212,
    "gflops": 19.78445283018868
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.13449999999999998,
    "gflops": 31.18441635687733
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.107833,
    "gflops": 38.89629334248328
  },
  {
    "kernel": "static-tiled",
    "n": 128,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.16366699999999998,
    "gflops": 25.627059822688754
  },
  {
    "kernel": "naive-ijk",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 14.269290999999999,
    "gflops": 2.351513610592145
  },
  {
    "kernel": "ikj",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.572583,
    "gflops": 13.04309015491434
  },
  {
    "kernel": "tiled",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.727958,
    "gflops": 12.300201102802902
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.626958,
    "gflops": 12.773113235917743
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 1.346917,
    "gflops": 24.912026502004206
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.6961660000000001,
    "gflops": 48.19889509111333
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.424292,
    "gflops": 79.08334826016046
  },
  {
    "kernel": "rayon-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.375917,
    "gflops": 89.26021435582854
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.662416,
    "gflops": 12.603001183887118
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 1.420458,
    "gflops": 23.622262678657165
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.743708,
    "gflops": 45.11775051498706
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.755834,
    "gflops": 44.39391718287349
  },
  {
    "kernel": "rayon-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.768,
    "gflops": 43.690666666666665
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.558458,
    "gflops": 13.11509979839419
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 1.320166,
    "gflops": 25.416827883766132
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.732167,
    "gflops": 45.828932470324396
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.417208,
    "gflops": 80.4261471496232
  },
  {
    "kernel": "static-ikj",
    "n": 256,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 0.5201669999999999,
    "gflops": 64.50703716306494
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 2.687125,
    "gflops": 12.487112434293158
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 1.389791,
    "gflops": 24.14350934780841
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 0.7630830000000001,
    "gflops": 43.97219175371487
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 0.48654200000000003,
    "gflops": 68.96512942356466
  },
  {
    "kernel": "static-tiled",
    "n": 256,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 10.037167,
    "gflops": 3.3430182042403
  },
  {
    "kernel": "naive-ijk",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 126.371167,
    "gflops": 2.124182773432804
  },
  {
    "kernel": "ikj",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 20.274,
    "gflops": 13.240379599487028
  },
  {
    "kernel": "tiled",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 25.275542,
    "gflops": 10.620363986655558
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 20.574624999999997,
    "gflops": 13.04691852220879
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 10.456375,
    "gflops": 25.67194233183106
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 5.544917,
    "gflops": 48.411086405801925
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 2.9529579999999997,
    "gflops": 90.90391939201304
  },
  {
    "kernel": "rayon-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 2.8075,
    "gflops": 95.61369759572574
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 25.322999999999997,
    "gflops": 10.600460293014258
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 13.566958,
    "gflops": 19.78597236020042
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 6.846125,
    "gflops": 39.20983855830853
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 5.051709,
    "gflops": 53.13755325178074
  },
  {
    "kernel": "rayon-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 4.755917,
    "gflops": 56.44241814985417
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 21.286292,
    "gflops": 12.61071942450099
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 10.545,
    "gflops": 25.456183594120432
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 5.591583,
    "gflops": 48.00705918163067
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 3.0353749999999997,
    "gflops": 88.4356812584936
  },
  {
    "kernel": "static-ikj",
    "n": 512,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 3.88425,
    "gflops": 69.10869691703674
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 25.094333,
    "gflops": 10.697054829072364
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 13.055833,
    "gflops": 20.560576716935643
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 6.724042000000001,
    "gflops": 39.92173992964351
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 3.4249169999999998,
    "gflops": 78.3772149806842
  },
  {
    "kernel": "static-tiled",
    "n": 512,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 4.6431249999999995,
    "gflops": 57.81353205007404
  },
  {
    "kernel": "naive-ijk",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1516.4742919999999,
    "gflops": 1.4161029035103485
  },
  {
    "kernel": "ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 172.44104199999998,
    "gflops": 12.453436972388511
  },
  {
    "kernel": "tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 243.53425000000001,
    "gflops": 8.817994380667196
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 176.93200000000002,
    "gflops": 12.137338909863676
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 91.62575000000001,
    "gflops": 23.43755601454831
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 45.389541,
    "gflops": 47.31230148372728
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 23.766292,
    "gflops": 90.35838017979412
  },
  {
    "kernel": "rayon-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 28.095208,
    "gflops": 76.4359405347702
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 235.827,
    "gflops": 9.10618227768661
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 123.186875,
    "gflops": 17.4327309463772
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 64.181791,
    "gflops": 33.459391122320035
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 31.749917000000003,
    "gflops": 67.637457067998
  },
  {
    "kernel": "rayon-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 34.985459,
    "gflops": 61.38217732115506
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 174.06887500000002,
    "gflops": 12.336976659382671
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 88.63562499999999,
    "gflops": 24.228222545957117
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 45.292458,
    "gflops": 47.41371395652671
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 24.219082999999998,
    "gflops": 88.66907339142443
  },
  {
    "kernel": "static-ikj",
    "n": 1024,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 28.158958000000002,
    "gflops": 76.2628946710315
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 238.259792,
    "gflops": 9.013202059708002
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 122.93175000000001,
    "gflops": 17.468909764971215
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 62.369417000000006,
    "gflops": 34.431677435753485
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 31.774833,
    "gflops": 67.58441965690268
  },
  {
    "kernel": "static-tiled",
    "n": 1024,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 32.713125000000005,
    "gflops": 65.64593410137368
  },
  {
    "kernel": "naive-ijk",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 28889.483584,
    "gflops": 0.5946755376934052
  },
  {
    "kernel": "ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1348.720375,
    "gflops": 12.73790290593037
  },
  {
    "kernel": "tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1659.4823330000002,
    "gflops": 10.352547202441352
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1490.561542,
    "gflops": 11.525769785357845
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 855.717792,
    "gflops": 20.076559520688335
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 521.5289170000001,
    "gflops": 32.941354973802916
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 258.744625,
    "gflops": 66.3970089581571
  },
  {
    "kernel": "rayon-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 275.856375,
    "gflops": 62.27831125526826
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1720.742208,
    "gflops": 9.983987783950495
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 877.449292,
    "gflops": 19.579329928959588
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 442.03912499999996,
    "gflops": 38.86504205708036
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 259.7145,
    "gflops": 66.14905669109734
  },
  {
    "kernel": "rayon-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 260.532583,
    "gflops": 65.94134593906053
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1406.100708,
    "gflops": 12.21809297602601
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 787.963042,
    "gflops": 21.802887024236856
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 516.89275,
    "gflops": 33.23681592361278
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 334.30808299999995,
    "gflops": 51.3893323482699
  },
  {
    "kernel": "static-ikj",
    "n": 2048,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 368.82716700000003,
    "gflops": 46.57972817929651
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 1699.0849589999998,
    "gflops": 10.111247876687253
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 873.277292,
    "gflops": 19.67286833332659
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 444.73454200000003,
    "gflops": 38.62949144166094
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 266.37841699999996,
    "gflops": 64.49422358418776
  },
  {
    "kernel": "static-tiled",
    "n": 2048,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 246.997791,
    "gflops": 69.55474830137247
  },
  {
    "kernel": "naive-ijk",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 264487.20924999996,
    "gflops": 0.5196431005557218
  },
  {
    "kernel": "ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 10863.528791,
    "gflops": 12.651409695334234
  },
  {
    "kernel": "tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 13630.848417,
    "gflops": 10.08293462500765
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 10799.496959,
    "gflops": 12.726421794809822
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 6532.455458,
    "gflops": 21.039401547496933
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 4847.4115839999995,
    "gflops": 28.35306040973475
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 3093.124791,
    "gflops": 44.43369173849798
  },
  {
    "kernel": "rayon-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 3133.2451250000004,
    "gflops": 43.864730651100906
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 14022.022584,
    "gflops": 9.801649701293906
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 7274.155917,
    "gflops": 18.89414456332996
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 3674.940125,
    "gflops": 37.398964009515666
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 2280.6697090000002,
    "gflops": 60.26254171291753
  },
  {
    "kernel": "rayon-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 2234.075125,
    "gflops": 61.51939652074144
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 10917.838958,
    "gflops": 12.588475979606951
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 6206.963334,
    "gflops": 22.142704262348072
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 4662.098916,
    "gflops": 29.480059507171557
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 3056.629583,
    "gflops": 44.96421621919505
  },
  {
    "kernel": "static-ikj",
    "n": 4096,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 3110.204333,
    "gflops": 44.189686193199705
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 1,
    "precision": "f64",
    "elapsed_ms": 14135.409582999999,
    "gflops": 9.723025899248894
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 2,
    "precision": "f64",
    "elapsed_ms": 7265.229875,
    "gflops": 18.917357858824804
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 4,
    "precision": "f64",
    "elapsed_ms": 3735.44675,
    "gflops": 36.793177006739555
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 8,
    "precision": "f64",
    "elapsed_ms": 2283.303458,
    "gflops": 60.19302996737283
  },
  {
    "kernel": "static-tiled",
    "n": 4096,
    "threads": 10,
    "precision": "f64",
    "elapsed_ms": 2137.174333,
    "gflops": 64.30872360284893
  }
];
